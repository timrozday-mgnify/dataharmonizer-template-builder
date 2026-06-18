import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'html-as-string',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!source.endsWith('.html') || !importer?.includes('/DataHarmonizer/')) return null;
        return `\0dh-html:${path.resolve(path.dirname(importer), source)}?module`;
      },
      load(id) {
        if (!id.startsWith('\0dh-html:')) return null;
        const htmlPath = id.replace('\0dh-html:', '').replace('?module', '');
        const code = fs.readFileSync(htmlPath, 'utf-8');
        return {
          code: `export default ${JSON.stringify(code)};`,
          map: null
        };
      }
    },
    {
      name: 'dataharmonizer-forced-schema-shims',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === 'data-harmonizer') return '\0dh-preview-library';
        if (source === 'schemas') return '\0dh-schemas';
        if (source === '.' && importer?.endsWith('/DataHarmonizer/lib/AppContext.js')) {
          return '\0dh-appcontext-index';
        }
        if (source === '../web' && importer?.endsWith('/DataHarmonizer/lib/AppContext.js')) {
          return '\0dh-preview-web';
        }
        return null;
      },
      load(id) {
        if (id === '\0dh-preview-library') {
          return {
            code: `
              import ${JSON.stringify(path.resolve(__dirname, '../DataHarmonizer/node_modules/bootstrap/dist/css/bootstrap.min.css'))};
              import ${JSON.stringify(path.resolve(__dirname, '../DataHarmonizer/web/index.css'))};
              export { default as AppContext } from ${JSON.stringify(
              path.resolve(__dirname, '../DataHarmonizer/lib/AppContext.js')
            )};
              export { default as Toolbar } from ${JSON.stringify(
              path.resolve(__dirname, '../DataHarmonizer/lib/Toolbar.js')
            )};
              export { default as Footer } from ${JSON.stringify(
              path.resolve(__dirname, '../DataHarmonizer/lib/Footer.js')
            )};
            `,
            map: null
          };
        }
        if (id === '\0dh-appcontext-index') {
          return {
            code: `export { default as DataHarmonizer } from ${JSON.stringify(
              path.resolve(__dirname, '../DataHarmonizer/lib/DataHarmonizer.js')
            )};`,
            map: null
          };
        }
        if (id === '\0dh-preview-web') {
          return {
            code: `
              export function createDataHarmonizerContainer(dhId, isActive) {
                const root = document.querySelector('#data-harmonizer-grid');
                if (!root) throw new Error('Missing #data-harmonizer-grid preview root.');
                const dhSubroot = document.createElement('div');
                dhSubroot.id = dhId;
                dhSubroot.classList.add('data-harmonizer-grid', 'tab-pane', 'fade');
                if (isActive) dhSubroot.classList.add('show', 'active');
                dhSubroot.setAttribute('aria-labelledby', 'tab-' + dhId);
                root.appendChild(dhSubroot);
                return dhSubroot;
              }
              export function createDataHarmonizerTab(dhId, tabTitle, isActive) {
                const root = document.querySelector('#data-harmonizer-tabs');
                if (!root) throw new Error('Missing #data-harmonizer-tabs preview root.');
                const item = document.createElement('li');
                item.className = 'nav-item';
                item.setAttribute('role', 'presentation');
                const link = document.createElement('button');
                link.type = 'button';
                link.className = 'nav-link' + (isActive ? ' active' : '');
                link.id = 'tab-' + dhId;
                link.textContent = tabTitle;
                link.setAttribute('role', 'tab');
                link.setAttribute('aria-controls', dhId);
                link.addEventListener('click', () => {
                  document.querySelectorAll('#data-harmonizer-tabs .nav-link').forEach((tab) => tab.classList.remove('active'));
                  document.querySelectorAll('#data-harmonizer-grid .tab-pane').forEach((pane) => pane.classList.remove('show', 'active'));
                  link.classList.add('active');
                  document.getElementById(dhId)?.classList.add('show', 'active');
                });
                item.appendChild(link);
                root.appendChild(item);
                return item;
              }
            `,
            map: null
          };
        }
        if (id !== '\0dh-schemas') return null;
        return {
          code: `
            export const menu = {};
            export const getSchema = async () => {
              throw new Error('Built DataHarmonizer templates are not available in forced-schema preview mode.');
            };
            export const getExportFormats = async () => ({});
          `,
          map: null
        };
      },
      transform(code, id) {
        if (!id.endsWith('/DataHarmonizer/lib/AppContext.js')) return null;
        return {
          code: code
            .replace("import * as $ from 'jquery';", "import $ from 'jquery';")
            .replace(
              `hot_override_settings: {
              minRows: is_child ? 0 : 10,
              minSpareRows: 0,
              height: is_child ? '50vh' : '75vh',
              // TODO: Workaround, possibly due to too small section column on child tables
              // colWidths: is_child ? 256 : undefined,
              colWidths: 200,
            },`,
              `helpSidebar: { enabled: false },
            hot_override_settings: {
              minRows: is_child ? 0 : 10,
              minSpareRows: 1,
              height: is_child ? '44vh' : '58vh',
              colWidths: 180,
              autoColumnSize: false,
              autoRowSize: false,
              fixedColumnsLeft: 0,
              filters: false,
              manualColumnResize: false,
              viewportColumnRenderingOffset: 8,
              viewportRowRenderingOffset: 20,
              renderAllRows: false,
              beforeChange: () => undefined,
              afterChange: () => undefined,
              afterSelection: () => undefined,
            },`
            ),
          map: null
        };
      }
    }
  ],
  resolve: {
    alias: {
      jquery: path.resolve(__dirname, '../DataHarmonizer/node_modules/jquery/dist/jquery.js')
    }
  },
  build: {
    outDir: 'frontend/dist',
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8765'
    }
  },
  optimizeDeps: {
    exclude: ['data-harmonizer']
  }
});
