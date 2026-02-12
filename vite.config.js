import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],
    base: "./",
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5174,
        strictPort: true,
        watch: {
            ignored: [
                path.resolve(__dirname, "python") + "/**",
                "**/node_modules/**",
            ],
        },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
