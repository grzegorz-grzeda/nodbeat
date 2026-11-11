import { lookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { DeliveryAttempt } from "./alerts.js";

/** One outgoing POST, e.g. an Alert to a Webhook or an ntfy topic. */
export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  /** The answer must start arriving within this long, or the request fails. */
  timeoutMs: number;
}

/** Sends HTTP requests for Alert channels. Never follows redirects: the answer's status is what counts. */
export interface HttpClient {
  post(request: HttpRequest): Promise<{ status: number }>;
}

/** Every address a host name resolves to. */
export type HostResolver = (hostname: string) => Promise<string[]>;

/** What an HTTP Alert channel's sender needs to reach it. */
export interface OutboundHttp {
  http: HttpClient;
  resolveHost: HostResolver;
}

/** How long a Webhook or ntfy server has to answer. */
export const HTTP_CHANNEL_TIMEOUT_MS = 5000;

/**
 * Addresses nodbeat never sends to: private, loopback, link-local, CGNAT and unique-local (v4 and v6), "this
 * network", documentation (TEST-NET), benchmarking, multicast, reserved and broadcast, and IPv6 prefixes that tunnel
 * to IPv4 (NAT64, 6to4, Teredo), which could reach a private address. Keeps a Webhook or ntfy URL from probing the
 * `edge` network or the VPS.
 */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  // Reserved, including the broadcast address 255.255.255.255.
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

/** Whether nodbeat refuses to send to this IP address. An IPv4 address mapped into IPv6 counts as itself. */
export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isBlockedAddress(mapped);
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** A URL nodbeat won't send to, with the reason in words for the User. */
export class OutboundUrlError extends Error {}

const blockedHostError = (host: string) =>
  new OutboundUrlError(`${host} resolves to a private or reserved address.`);
const noAddressError = (host: string) =>
  new OutboundUrlError(`${host} has no address.`);

/** Longest URL accepted for an Alert channel. */
export const MAX_OUTBOUND_URL_LENGTH = 2000;

/**
 * The URL parsed, once it is safe to send to: `http` or `https`, no credentials, and a host whose every address is
 * public. Run on save and again before every send (a name may resolve elsewhere later). Throws OutboundUrlError.
 */
export async function checkOutboundUrl(
  value: string,
  resolve: HostResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundUrlError("That isn't a valid URL.");
  }
  if (value.length > MAX_OUTBOUND_URL_LENGTH) {
    throw new OutboundUrlError(
      `A URL can have at most ${MAX_OUTBOUND_URL_LENGTH} characters.`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OutboundUrlError("The URL must start with https:// or http://.");
  }
  if (url.username || url.password) {
    throw new OutboundUrlError(
      "The URL can't contain a user name or password.",
    );
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new OutboundUrlError(`${host} can't be resolved.`);
  }
  if (addresses.length === 0) throw noAddressError(host);
  if (addresses.some(isBlockedAddress)) throw blockedHostError(host);
  return url;
}

/** POSTs after checking the URL (OutboundUrlError when it isn't safe). The one way Alert channels send over HTTP. */
export async function guardedPost(
  deps: OutboundHttp,
  request: HttpRequest,
): Promise<{ status: number }> {
  await checkOutboundUrl(request.url, deps.resolveHost);
  return deps.http.post(request);
}

/**
 * Sends an Alert to an HTTP Alert channel (any kind) and records the outcome: any 2xx is delivered; another status,
 * a timeout, a network error, or a URL now resolving to a blocked address is a failure worth retrying.
 */
export async function postAlert(
  deps: OutboundHttp,
  channelId: string,
  request: HttpRequest,
  attempt: DeliveryAttempt,
): Promise<void> {
  try {
    const { status } = await guardedPost(deps, request);
    if (status >= 200 && status < 300) attempt.delivered.add(channelId);
    else attempt.failed.set(channelId, `HTTP ${status}`);
  } catch (err) {
    attempt.failed.set(
      channelId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Resolves through the system resolver, every address. */
export const dnsResolver: HostResolver = (hostname) =>
  new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses.map((a) => a.address));
    });
  });

/**
 * Resolves like `dns.lookup` but fails for blocked addresses, so a name re-resolved at connect time can't swap in a
 * private address after the check.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    if (list.length === 0) return callback(noAddressError(hostname), "", 0);
    if (list.some((a) => isBlockedAddress(a.address))) {
      return callback(blockedHostError(hostname), "", 0);
    }
    if (options.all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(
        null,
        list,
      );
    } else {
      callback(null, list[0]!.address, list[0]!.family);
    }
  });
};

/** The real HttpClient over `node:http(s)`. Redirects aren't followed; the body of the answer is discarded. */
export function createNodeHttpClient(): HttpClient {
  return {
    post: (request) =>
      new Promise((resolve, reject) => {
        const url = new URL(request.url);
        const client = url.protocol === "https:" ? https : http;
        const req = client.request(
          url,
          {
            method: "POST",
            headers: {
              ...request.headers,
              "content-length": String(Buffer.byteLength(request.body)),
            },
            lookup: guardedLookup,
          },
          (res) => {
            clearTimeout(timer);
            res.resume();
            resolve({ status: res.statusCode ?? 0 });
          },
        );
        const timer = setTimeout(() => {
          req.destroy(
            new Error(`No answer within ${request.timeoutMs / 1000} s`),
          );
        }, request.timeoutMs);
        req.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        req.end(request.body);
      }),
  };
}
