/* GHL renders the panel inside an iframe on the agency white-label domain, and falls back
   to its own domains for some users. Extra parents can be added without a code change. */
const FRAME_ANCESTORS = [
  "'self'",
  "https://iaorbita.com",
  "https://*.iaorbita.com",
  "https://*.gohighlevel.com",
  "https://*.leadconnectorhq.com",
  "https://*.msgsndr.com",
  ...(process.env.PANEL_FRAME_ANCESTORS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${FRAME_ANCESTORS.join(" ")}`,
          },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
