import type { NextConfig } from "next";

const isGithubActions = process.env.GITHUB_ACTIONS === "true" || Boolean(process.env.GITHUB_ACTIONS);

let repo = "";
if (isGithubActions && process.env.GITHUB_REPOSITORY) {
  const repoName = process.env.GITHUB_REPOSITORY.split("/")[1];
  if (repoName && !repoName.endsWith(".github.io")) {
    repo = `/${repoName}`;
  }
}

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || (repo ? repo : undefined);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  output: isGithubActions ? "export" : undefined,
  basePath: basePath,
  assetPrefix: basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath || "",
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
        port: "",
        pathname: "/**",
      },
    ],
  },
  transpilePackages: ["motion"],
  webpack: (config, { dev }) => {
    if (dev && process.env.DISABLE_HMR === "true") {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
