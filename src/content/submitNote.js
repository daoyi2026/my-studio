export const NOTE_ENDPOINT = "https://formspree.io/f/mkjjwpoa";

export async function submitFeltNote(note, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const payload = Object.fromEntries(["name", "contact", "message"].map((key) => [key, typeof note?.[key] === "string" ? note[key].trim() : ""]));
  if (Object.values(payload).some((value) => !value)) throw new Error("Please add your name, contact information and note.");
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("No confirmation before timeout. Your draft is kept; retry if needed."));
      controller.abort();
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetchImpl(NOTE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: "error",
      }).then(async (response) => {
        let data;
        try { data = await response.json(); } catch { throw new Error("Could not confirm acceptance. Your draft is kept; please retry."); }
        if (!response.ok || !data || typeof data !== "object" || Array.isArray(data) || data.ok === false || data.errors?.length) {
          throw new Error("Your note could not be accepted. Your draft is kept; please retry.");
        }
        return response;
      }),
      timeout,
    ]);
    return response.ok;
  } catch (error) {
    if (error instanceof TypeError || error.name === "AbortError") {
      throw new Error("Could not confirm acceptance. Your draft is kept; retry when connected.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
