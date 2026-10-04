export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error("Backendga ulanib bo'lmadi. .env sozlamalarini tekshirib, npm run dev buyrug'ini ishga tushiring.");
  }

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error || (response.status >= 500
      ? "Backend ishga tushmagan yoki .env/DB sozlamasi xato. README dagi local setup qadamlarini bajaring."
      : `Server xatosi (${response.status})`);
    throw new Error(message);
  }
  return payload;
}

export const jsonBody = value => JSON.stringify(value);