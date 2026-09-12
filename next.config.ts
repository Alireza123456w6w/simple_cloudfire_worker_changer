import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // فایل کد ورکر (worker.js ریشه) باید همراه خروجی API روت‌ها بسته‌بندی شود
  // تا روی هر هاستی (Vercel و…) پنل بتواند آن را بخواند و دیپلوی کند
  outputFileTracingIncludes: {
    "/api/deploy": ["./worker.js"],
    "/api/deploy/route": ["./worker.js"],
    "/api/worker-code": ["./worker.js"],
    "/api/worker-code/route": ["./worker.js"],
  },
};

export default nextConfig;
