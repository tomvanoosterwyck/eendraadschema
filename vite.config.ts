import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const formatDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
};

export default defineConfig({
    define: {
        BUILD_DATE: JSON.stringify(formatDate()) // Injects current date/time
    },
    build: {
        target: "es2017", // Match your tsconfig.json
        /*minify: "terser",*/  // Minifies the output
        //minify: false, // Disable minification for easier debugging
        outDir: "dist",
        manifest: false, // We handle this ourselves, not through Vite
        rollupOptions: {
            input: {
                main: 'index.html'
            },
            output: {
                inlineDynamicImports: true, // Forces everything into one file
                format: "esm",              // Keeps ES module format
                entryFileNames: "bundle.js" // Generates `bundle.js`
            },
            external: [
                "prop/prop_scripts_js.js",
                "builddate.js",
                "resources/pako/pako.min.js",
                "resources/jsPDF/jspdf.umd.min.js",
                "resources/jsPDF/print.js"
            ]
        }
    },
    plugins: [
        viteSingleFile(),
        {
            name: 'copy-static-runtime-assets',
            apply: 'build',
            closeBundle() {
                const projectRoot = process.cwd();
                const distRoot = resolve(projectRoot, 'dist');

                const ensureDir = (absDir: string) => {
                    if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });
                };

                const copyPath = (srcRel: string, destRel: string = srcRel) => {
                    const srcAbs = resolve(projectRoot, srcRel);
                    const destAbs = resolve(distRoot, destRel);
                    if (!existsSync(srcAbs)) return;
                    ensureDir(dirname(destAbs));
                    cpSync(srcAbs, destAbs, { recursive: true, force: true });
                };

                // Files referenced at runtime by HTML/JS.
                copyPath('license.html');

                // Runtime static assets referenced by <img>, window.open, and external scripts.
                copyPath('gif');
                copyPath('examples');
                copyPath('resources');
                copyPath('prop');
                copyPath('Documentation');
            }
        }
    ]
});
