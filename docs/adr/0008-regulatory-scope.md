# Regulatory scope: GDPR and consumer law yes; CRA, NIS2 and EAA not for now

G2Labs (a Polish sole proprietorship) is the Operator of nodbeat.g2labs.pl and sells Pro to consumers and businesses in the EU. That puts it under GDPR, Polish and EU consumer law (UŚUDE Terms, 14-day refund for consumers), VAT OSS and the DSA's basic hosting duties. It judges the Cyber Resilience Act, NIS2 and the European Accessibility Act not to apply for now: nodbeat is a hosted service, not a product placed on the market; the MIT source and Docker image are given away without monetisation; and G2Labs is a microenterprise, which NIS2 and the EAA exclude for services. This is the Operator's reading, not legal advice, and is to be checked by a lawyer before Pro is sold.

## Consequences

- Revisit when any of these happens: the self-hosted version is sold, supported for money or bundled with paid features; G2Labs grows past 10 people or €2M turnover; nodbeat is offered to a NIS2 essential entity under contract terms that require it.
- Done anyway because it's cheap and expected of a good service: `security.txt` and `SECURITY.md` with a vulnerability reporting route, an owner runbook for breaches (UODO within 72 h), and support (spec 0019).
- For business Users nodbeat is a processor of what they put in Heartbeat messages and Monitor names, so the Terms carry Art. 28 processor terms (spec 0014) instead of a separately signed DPA.
- Self-hosters are the Operator of their own instance: nodbeat's code ships no Terms, Privacy policy or seller details (spec 0014 loads them from the Operator's own files).
