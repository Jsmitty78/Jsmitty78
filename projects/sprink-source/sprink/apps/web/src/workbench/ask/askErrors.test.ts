import { describe, expect, it } from "vitest";
import { ApiError } from "../api.js";
import { AskTimeoutError, describeAskError } from "./askErrors.js";

describe("Ask error wording", () => {
  it("classifies each failure the fitter can meet", () => {
    expect(describeAskError(new ApiError(401, "401", "Unauthorized")).kind).toBe("auth");
    expect(describeAskError(new AskTimeoutError()).kind).toBe("timeout");
    expect(describeAskError(new ApiError(504, "504", "Gateway Timeout")).kind).toBe("timeout");
    expect(describeAskError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(describeAskError(new ApiError(503, "source_search_transport_failed", "Source search is unavailable. Please try again.")).kind).toBe("unavailable");
    expect(describeAskError(new ApiError(400, "invalid_json", "Invalid JSON")).kind).toBe("invalid");
    expect(describeAskError(new ApiError(500, "internal_error", "Source library operation failed")).kind).toBe("server");
  });

  it("passes through the server's own question validation wording only", () => {
    expect(describeAskError(new ApiError(400, "invalid_question", "Keep the question under 1000 characters.")).detail).toBe("Keep the question under 1000 characters.");
    expect(describeAskError(new ApiError(400, "invalid_json", "Unexpected token < in JSON at position 0")).detail).not.toContain("Unexpected token");
  });

  it("never shows internal detail from the server or a thrown exception", () => {
    const leaky = [
      new ApiError(422, "source_section_too_large", "Section 10.2.6 exceeds the search input budget. Split it into smaller sections before searching."),
      new ApiError(500, "internal_error", "Error: ECONNREFUSED 10.0.0.4:5432\n    at TCPConnectWrap.afterConnect"),
      new Error("TYPESAFE_API_KEY=sk-live-123 is invalid"),
    ];
    for (const e of leaky) {
      const p = describeAskError(e);
      expect(`${p.title} ${p.detail}`).not.toMatch(/budget|ECONNREFUSED|TCPConnect|API_KEY|sk-live|10\.2\.6/);
    }
  });

  it("keeps retry available only where retrying can help", () => {
    expect(describeAskError(new ApiError(503, "source_search_unavailable", "x")).retry).toBe(true);
    expect(describeAskError(new ApiError(401, "401", "x")).retry).toBe(false);
    expect(describeAskError(new ApiError(400, "invalid_question", "Type a question.")).retry).toBe(false);
  });
});
