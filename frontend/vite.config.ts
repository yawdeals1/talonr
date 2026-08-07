import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // VITE_API_URL is inlined into the client bundle at build time — anyone can read it via
  // view-source. Refuse to produce a production build that would ship a plaintext/raw-IP
  // backend address, since that also means every login/Bearer-token request goes out
  // unencrypted. Safe values: a relative path (same-origin, proxied) or an https:// URL.
  if (mode === "production") {
    const apiUrl = loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL;
    if (apiUrl && !apiUrl.startsWith("/") && !apiUrl.startsWith("https://")) {
      throw new Error(
        `Refusing to build: VITE_API_URL="${apiUrl}" is not safe for production. ` +
          `It must be a relative path (e.g. "/backend") or an https:// URL — never a plain http:// address.`
      );
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5199,
      strictPort: true,
    },
  };
});
