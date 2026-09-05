import { describe, expect, it } from "vitest";
import { scrubSentryEvent } from "../../sentry/privacy";

describe("Sentry event privacy", () => {
  it("drops user and request details while retaining route diagnostics", () => {
    const event = {
      user: { id: "42", email: "person@example.com", ip_address: "127.0.0.1" },
      request: {
        method: "GET",
        url: "https://kolme.app/admin?token=secret#private",
        headers: { authorization: "Bearer secret" },
        cookies: "session=secret",
        data: { title: "private" },
      },
    };

    expect(scrubSentryEvent(event)).toEqual({
      request: { method: "GET", url: "https://kolme.app/admin" },
    });
  });

  it("redacts identifiers and sensitive nested fields", () => {
    const event = {
      message: "Failed for person@example.com with Bearer abcdefghijklmnopqrstuvwxyz",
      exception: { values: [{ value: "Contact person@example.com at https://kolme.app/path?name=private" }] },
      extra: {
        profileId: "public-diagnostic-id",
        accessToken: "secret-token-value",
        nested: { href: "https://kolme.app/title?profile=42#taste" },
      },
      breadcrumbs: [{ message: "Opened https://kolme.app/search?q=private" }],
    };

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.message).toBe("Failed for [redacted-email] with [redacted-token]");
    expect(scrubbed.exception.values[0].value).toBe("Contact [redacted-email] at https://kolme.app/path");
    expect(scrubbed.extra.accessToken).toBe("[redacted]");
    expect(scrubbed.extra.nested.href).toBe("https://kolme.app/title");
    expect(scrubbed.breadcrumbs[0].message).toBe("Opened https://kolme.app/search");
  });

  it("does not mutate the event supplied by the SDK", () => {
    const event = {
      request: { method: "POST", url: "https://kolme.app/path?private=yes" },
      extra: { email: "person@example.com" },
    };

    scrubSentryEvent(event);

    expect(event.request.url).toContain("?private=yes");
    expect(event.extra.email).toBe("person@example.com");
  });
});
