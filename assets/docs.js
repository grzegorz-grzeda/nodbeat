// Boots Swagger UI on /docs. A file, not an inline script, so the page passes the strict CSP.
// The document's `servers` is this instance's PUBLIC_BASE_URL, so "Try it out" targets it.
/* global SwaggerUIBundle */
window.addEventListener("DOMContentLoaded", () => {
  SwaggerUIBundle({
    url: "/openapi.yaml",
    dom_id: "#swagger-ui",
    tryItOutEnabled: true,
    deepLinking: true,
    // Default is a badge loaded from validator.swagger.io: a third-party request.
    validatorUrl: null,
  });
});
