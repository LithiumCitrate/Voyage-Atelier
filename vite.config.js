import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
  },
  resolve: {
    alias: {
      vue: "vue/dist/vue.esm-bundler.js"
    },
    preserveSymlinks: true
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
