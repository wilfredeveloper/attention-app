import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "js", "jsx", "md", "mdx"],
  // The old address of the lab's separate build opens /steer instead (query kept: its topic still works).
  async redirects() {
    return [
      {
        source: "/labs/spaceship/index.html",
        destination: "/steer",
        permanent: false,
      },
    ];
  },
};

// Turbopack serializes loader options, so remark/rehype plugins must be passed
// as module-name strings (or [name, options] tuples), not imported functions.
const withMDX = createMDX({
  options: {
    remarkPlugins: [
      "remark-frontmatter",
      ["remark-mdx-frontmatter", { name: "frontmatter" }],
    ],
  },
});

export default withMDX(nextConfig);
