'use strict';

const path = require('path');
import { AST, ASTPlugin } from "@glimmer/syntax";

import { buildOutput, createTempDir, TempDir } from 'broccoli-test-helper';

const MockCLI = require('ember-cli/tests/helpers/mock-cli');
const Project = require('ember-cli/lib/models/project');
const stew = require('broccoli-stew');
const td = require('testdouble');

const { stripIndent } = require('common-tags');

import GlimmerApp from '../../lib/broccoli/glimmer-app';
import { GlimmerAppOptions } from '../../lib/interfaces';
import { Tree } from 'broccoli';
import { NodePath } from "babel-traverse";
import { StringLiteral } from 'babel-types';
import * as SimpleDOM from 'simple-dom';

const expect = require('../helpers/chai').expect;

class TestGlimmerApp extends GlimmerApp {
  public getRegistry() { return this.registry; }
}

describe('glimmer-app', function() {
  this.timeout(15000);

  let input: TempDir;

  const ORIGINAL_EMBER_ENV = process.env.EMBER_ENV;

  beforeEach(function() {
    return createTempDir().then(tempDir => (input = tempDir));
  });

  afterEach(function() {
    if (ORIGINAL_EMBER_ENV) {
      process.env.EMBER_ENV = ORIGINAL_EMBER_ENV;
    } else {
      delete process.env.EMBER_ENV;
    }

    return input.dispose();
  });

  function createApp(options: GlimmerAppOptions = {}, addons: any[] = []): TestGlimmerApp {
    let pkg = { name: 'glimmer-app-test' };

    let cli = new MockCLI();
    let project = new Project(input.path(), pkg, cli.ui, cli);
    project.initializeAddons();
    project.addons = project.addons.concat(addons);

    return new TestGlimmerApp({
      project
    }, options);
  }

  describe('constructor', function() {
    it('throws an error if no arguments are provided', function() {
      expect(() => {
        const AnyGlimmerApp = GlimmerApp as any;
        new AnyGlimmerApp();
      }).to.throw(/must pass through the default arguments/)
    });

    it('throws an error if project is not passed through', function() {
      expect(() => {
        const AnyGlimmerApp = GlimmerApp as any;
        new AnyGlimmerApp({});
      }).to.throw(/must pass through the default arguments/)
    });

    it('throws an error if no src directory is found', function() {
      expect(() => {
        createApp();
      }).to.throw(/Could not find a src\/ directory/);
    });

    describe('env', function() {
      beforeEach(function() {
        delete process.env.EMBER_ENV;
        input.write({ src: {} });
      });

      it('sets an `env`', function() {
        let app = createApp();

        expect(app.env).to.be.defined;
      })

      it('sets an `env` to `development` if process.env.EMBER_ENV is undefined', function() {
        let app = createApp();

        expect(app.env).to.equal('development');
      })

      it('sets an `env` to process.env.EMBER_ENV if present', function() {
        process.env.EMBER_ENV = 'test';

        let app = createApp();

        expect(app.env).to.equal('test');
      })
    })
  });

  describe('buildTree', function() {
    it('invokes preprocessTree on addons that are present', async function() {
      input.write({
        'src': {
          'ui': {
            'index.html': 'src',
          },
        },
        'config': {},
      });

      let app = createApp({}, [
        {
          name: 'awesome-reverser',
          preprocessTree(type: string, tree: Tree) {
            return stew.map(tree, (contents: string) => contents.split('').reverse().join(''));
          }
        }
      ]);

      let output = await buildOutput(app['trees'].src);

      expect(output.read()).to.deep.equal({
        'src': {
          'ui': {
            'index.html': 'crs',
          }
        }
      });
    });
  });

  describe('lintTree', function() {
    const ORIGINAL_EMBER_ENV = process.env.EMBER_ENV;

    beforeEach(() => {
      process.env.EMBER_ENV = 'test';
    });

    afterEach(() => {
      process.env.EMBER_ENV = ORIGINAL_EMBER_ENV;
    });

    it('invokes lintTree hook on addons', async function() {
      input.write({
        'src': {
          'index.ts': 'export default {};',
          'ui': {
            'index.html': 'src',
          },
          'utils': {
            'test-helpers': {
              'test-helper.ts': ''
            }
          }
        },
        'config': {}
      });

      let lint = td.function('lintTree');

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        }
      }, [
        {
          name: 'awesome-linter',
          lintTree: lint
        }
      ]);

      await buildOutput(app.toTree());
      td.verify(lint('templates', td.matchers.anything()));
      td.verify(lint('src', td.matchers.anything()));

    });

  }),

  describe('publicTree', function() {
    it('includes any files in `public/` in the project', async function() {
      input.write({
        'public': {
          'hi.txt': 'hi hi'
        },
        'src': {},
        'config': {},
      });

      let app = createApp();
      let output = await buildOutput(app['publicTree']());

      expect(output.read()).to.deep.equal({
        'hi.txt': 'hi hi'
      });
    });

    it('includes treeFor("public") from addons', async function() {
      input.write({
        'public': {
          'hi.txt': 'hi hi'
        },
        'src': {},
        'config': {},
      });

      let addonPublic = await createTempDir();

      addonPublic.write({
        'bye.txt': 'bye bye'
      });

      let app = createApp({}, [
        {
          name: 'thing-with-public',
          treeFor() {
            return addonPublic.path();
          }
        }
      ]);

      let output = await buildOutput(app['publicTree']());

      expect(output.read()).to.deep.equal({
        'hi.txt': 'hi hi',
        'bye.txt': 'bye bye',
      });
    });
  });

  describe('htmlTree', function() {
    it('emits index.html', async function () {
      input.write({
        'app': {},
        'src': {
          'ui': {
            'index.html': 'src',
          },
        },
        'config': {},
      });

      let app = createApp();
      let output = await buildOutput(app['htmlTree']());

      expect(output.read()).to.deep.equal({
        'index.html': 'src',
      });
    });

    it('updates rootURL from config', async function () {
      input.write({
        'app': {},
        'src': {
          'ui': {
            'index.html': stripIndent`
              <body>
               <head>
                 <script src="{{rootURL}}bar.js"></script>
               </head>
              </body>`,
          },
        },
        'config': {
          'environment.js': `
            module.exports = function() {
              return { rootURL: '/foo/' };
            };`
        },
      });

      let app = createApp() as any;
      let output = await buildOutput(app.htmlTree());

      expect(output.read()).to.deep.equal({
        'index.html': stripIndent`
              <body>
               <head>
                 <script src="/foo/bar.js"></script>
               </head>
              </body>`
      });
    });

    it('allows passing custom `src` tree', async function () {
      input.write({
        'app': {},
        'derp': {
          'ui': {
            'index.html': 'derp'
          }
        },
        'src': {
          'ui': {
            'index.html': 'src',
          },
        },
        'config': {},
      });

      let app = createApp({
        trees: {
          src: 'derp'
        }
      }) as any;

      let output = await buildOutput(app.htmlTree());

      expect(output.read()).to.deep.equal({
        'index.html': 'derp',
      });
    });

    it('allows passing custom outputPaths', async function() {
      input.write({
        'app': {},
        'src': {
          'ui': {
            'index.html': 'src',
          },
        },
        'config': {},
      });

      let app = createApp({
        outputPaths: {
          app: { html: 'foo.html' }
        }
      }) as any;

      let output = await buildOutput(app.htmlTree());

      expect(output.read()).to.deep.equal({
        'foo.html': 'src',
      });
    });
  });

  describe('cssTree', function() {
    it('allows passing custom `styles` tree', async function () {
      input.write({
        'app': {},
        'derp': {
          'ui': {
            'styles': {
              'app.css': 'derp'
            }
          }
        },
        'src': {
          'index.ts': 'export default {};',
          'ui': {
            'index.html': 'src'
          },
        },
        'config': {},
      });

      let app = createApp({
        trees: {
          styles: 'derp/ui/styles',
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        }
      }) as any;

      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(actual['app.css']).to.equal('derp');
    });

    it('does not generate app.css without styles', async function () {
      input.write({
        'app': {},
        'src': {
          'index.ts': 'export default {};',
          'ui': {
            'index.html': 'src',
          },
        },
        'config': {},
      });

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        }
      }) as any;
      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(actual['app.css']).to.be.undefined;
    });

    it('passes through css', async function () {
      input.write({
        'app': {},
        'src': {
          'index.ts': 'export default {};',
          'ui': {
            'index.html': '',
            'styles': {
              'app.css': `body { color: #333; }`
            },
          }
        },
        'config': {},
      });

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        }
      }) as any;
      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(actual['app.css']).to.equal(`body { color: #333; }`);
    });

    it('respects outputPaths.app.css with plain css', async function () {
      input.write({
        'app': {},
        'src': {
          'index.ts': 'console.log("hello world");',
          'ui': {
            'index.html': '',
            'styles': {
              'app.css': `body { color: #333; }`
            },
          }
        },
        'config': {},
      });

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        },
        outputPaths: {
          app: {
            css: 'foo-bar.css'
          }
        }
      }) as any;
      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(actual['foo-bar.css']).to.equal(`body { color: #333; }`);
    });
  });

  describe('testPackage', function() {
    const ORIGINAL_EMBER_ENV = process.env.EMBER_ENV;

    beforeEach(() => {
      process.env.EMBER_ENV = 'test';
    });

    afterEach(() => {
      process.env.EMBER_ENV = ORIGINAL_EMBER_ENV;
    });

    const tsconfigContents = stripIndent`
      {
        "compilerOptions": {
          "target": "es6",
          "module": "es2015",
          "inlineSourceMap": true,
          "inlineSources": true,
          "moduleResolution": "node",
          "experimentalDecorators": true
        },
        "exclude": [
          "node_modules",
          "tmp",
          "dist"
        ]
      }
    `;

    it('builds test files along with src files', async function() {
      input.write({
        'src': {
          'index.ts': 'console.log("foo");',
          'ui': {
            'components': {
              'foo-bar': {
                'template.d.ts': 'declare const _d: {}; export default _d;',
                'template.hbs': `<div>Hello!</div>`,
                'component.ts': 'console.log("qux"); export default class FooBar {}',
                'component-test.ts': 'import template from "./template"; import FooBar from "./component"; console.log(template); console.log(FooBar);'
              }
            }
          },
          'utils': {
            'test-helpers': {
              'test-helper.ts': 'import "../../../tests"'
            }
          }
        },
        'config': {},
        'tsconfig.json': tsconfigContents
      });

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        }
      });
      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(app.env).to.eq('test');
      expect(actual['index.js'], 'builds src').to.include('console.log("qux")');
      expect(actual['index.js'], 'builds tests').to.include('console.log(FooBar)');
      expect(actual['index.js'], 'builds module map which includes the compiled templates').to.include('Hello!');
    });
  });

  describe('toTree', function() {

    const tsconfigContents = stripIndent`
      {
        "compilerOptions": {
          "target": "es6",
          "module": "es2015",
          "inlineSourceMap": true,
          "inlineSources": true,
          "moduleResolution": "node",
          "experimentalDecorators": true
        },
        "exclude": [
          "node_modules",
          "tmp",
          "dist"
        ]
      }
    `;

    it('transpiles templates', async function() {
      input.write({
        'src': {
          'index.ts': 'import template from "./ui/components/foo-bar"; console.log(template);',
          'ui': {
            'index.html': 'src',
            'components': {
              'foo-bar.hbs': `<div>Hello!</div>`
            },
          }
        },
        'config': {},
        'tsconfig.json': tsconfigContents
      });

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        }
      });
      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(actual['index.html']).to.equal('src');
      expect(actual['app.js']).to.include('Hello!');
    });

    describe('allows userland babel plugins', function() {
      function reverser () {
        return {
          name: "ast-transform",
          visitor: {
            StringLiteral(path: NodePath<StringLiteral>) {
              path.node.value = path.node.value.split('').reverse().join('');
            }
          }
        };
      }

      it('runs user-land plugins', async function() {
        input.write({
          'src': {
            'index.ts': 'console.log(\'olleh\');',
            'ui': {
              'index.html': 'src'
            }
          },
          'config': {},
          'tsconfig.json': tsconfigContents
        });

        let app = createApp({
          babel: {
            plugins: [
              [reverser]
            ]
          },
          trees: {
            nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
          }
        });
        let output = await buildOutput(app.toTree());
        let actual = output.read();

        expect(actual['index.html']).to.equal('src');
        expect(actual['app.js']).to.include('hello');
      });
    });

    describe('babel-plugin-debug-macros', function() {
      it('replaces @glimmer/env imports', async function() {
        input.write({
          'src': {
            'index.ts': 'import { DEBUG } from "@glimmer/env"; console.log(DEBUG);',
            'ui': {
              'index.html': 'src'
            }
          },
          'config': {},
          'tsconfig.json': tsconfigContents
        });

        let app = createApp({
          trees: {
            nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
          }
        });
        let output = await buildOutput(app.toTree());
        let actual = output.read();

        expect(actual['index.html']).to.equal('src');
        expect(actual['app.js']).to.include('console.log(true)');
      });

      it('rewrites @glimmer/debug imports', async function() {
        input.write({
          'src': {
            'index.ts': 'import { assert } from "@glimmer/debug"; assert(true, "some message for debug");',
            'ui': {
              'index.html': 'src'
            }
          },
          'config': {},
          'tsconfig.json': tsconfigContents
        });

        let app = createApp({
          trees: {
            nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
          }
        });
        let output = await buildOutput(app.toTree());
        let actual = output.read();

        expect(actual['index.html']).to.equal('src');
        expect(actual['app.js']).to.include('true && console.assert(true');
      });

      it('removes @glimmer/debug imports in production builds', async function() {
        process.env.EMBER_ENV = 'production';

        input.write({
          'src': {
            'index.ts': 'import { assert } from "@glimmer/debug"; assert(true, "some message for debug");',
            'ui': {
              'index.html': 'src'
            }
          },
          'config': {},
          'tsconfig.json': tsconfigContents
        });

        let app = createApp({
          trees: {
            nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
          }
        });
        let output = await buildOutput(app.toTree());
        let actual = output.read();

        expect(actual['index.html']).to.equal('src');

        let outputFiles = Object.keys(actual);
        let appFile = outputFiles.find(fileName => fileName.startsWith('app'));

        expect(actual[appFile!]).to.include('false && console.assert(true');
      });
    });

    it('builds a module map', async function() {
      input.write({
        'src': {
          'index.ts': 'import moduleMap from "../config/module-map"; console.log(moduleMap);',
          'ui': {
            'index.html': 'src',
            'components': {
              'foo-bar': {
                'template.hbs': `<div>Hello!</div>`
              }
            },
          }
        },
        'config': {},
        'tsconfig.json': tsconfigContents
      });

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        }
      });
      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(actual['index.html']).to.equal('src');
      expect(actual['app.js']).to.include('template:/glimmer-app-test/components/foo-bar');
    });

    it('includes resolver config', async function() {
      input.write({
        'src': {
          'index.ts': 'import resolverConfig from "../config/resolver-configuration"; console.log(resolverConfig);',
          'ui': {
            'index.html': 'src'
          }
        },
        'config': {},
        'tsconfig.json': tsconfigContents
      });

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        }
      });
      let output = await buildOutput(app.toTree());
      let actual = output.read();

      // it would be much better to confirm the full expected resolver config
      // but rollup actually reformats the code so it doesn't match a simple
      // JSON.stringify'ied version of the defaultModuleConfiguration
      expect(actual['app.js']).to.include('glimmer-app-test');
      expect(actual['app.js']).to.include('definitiveCollection');
    });

    it('honors outputPaths.app.js', async function() {
      input.write({
        'src': {
          'index.ts': 'console.log("hello world");',
          'ui': {
            'index.html': 'src'
          }
        },
        'config': {},
        'tsconfig.json': tsconfigContents
      });

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        },
        outputPaths: {
          app: {
            js: 'foo-bar-file.js'
          }
        }
      });
      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(actual['foo-bar-file.js']).to.be.defined;
    });

    it('allows specifying rollup options', async function() {

      input.write({
        'src': {
          'index.ts': 'console.log("NOW YOU SEE ME");',
          'ui': {
            'index.html': 'src'
          }
        },
        'config': {},
        'tsconfig.json': tsconfigContents
      });

      let app = createApp({
        trees: {
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        },
        rollup: {
          plugins: [
            {
              name: 'test-replacement',
              transform(code: string, id: string) {
                return code.replace('NOW YOU SEE ME', 'NOW YOU DON\'T');
              }
            }
          ]
        }
      });

      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(actual['app.js']).to.include('NOW YOU DON\'T');
    });

    it('allows passing custom Broccoli nodes', async function() {
      input.write({
        'src': {
          'index.ts': '',
          'ui': {
            'index.html': 'src'
          }
        },
        'config': {},
        'tsconfig.json': tsconfigContents
      });

      let app = createApp({
        trees: {
          src: stew.log(path.join(input.path(), 'src')),
          nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
        },
      });
      let output = await buildOutput(app.toTree());
      let actual = output.read();

      expect(actual['app.js']).to.be.defined;
    });

    describe('`getGlimmerEnvironment`', () => {
      it('returns application options from `config/environment.js` if it is specified via `GlimmerENV`', () => {
        input.write({
          'app': {},
          'src': {
            'ui': {
              'index.html': 'src',
            },
          },
          'config': {
            'environment.js': `
            module.exports = function() {
              return { GlimmerENV: { FEATURES: {} } };
            };`
          },
        });
        let app = createApp();

        expect(app.getGlimmerEnvironment()).to.deep.equal({ FEATURES: {} });
      });

      it('returns application options from `config/environment.js` if it is specified via `EmberENV`', () => {
        input.write({
          'app': {},
          'src': {
            'ui': {
              'index.html': 'src',
            },
          },
          'config': {
            'environment.js': `
            module.exports = function() {
              return { EmberENV: { FEATURES: {} } };
            };`
          },
        });
        let app = createApp();

        expect(app.getGlimmerEnvironment()).to.deep.equal({ FEATURES: {} });
      });
    });

    describe('glimer-ast-plugin', () => {
      it('applies `glimmer-ast-plugin`s discovered in the app registry', async () => {

        input.write({
          'package.json': JSON.stringify({ name: 'glimmer-app-test', version: '0.1.0' }),
          'config': {
            'resolver-configuration.d.ts': `declare var _default: any; export default _default;`,
            'module-map.d.ts': `export interface Dict<T> { [index: string]: T; } declare let map: Dict<any>; export default map;`
          },
          'src': {
            'index.ts': `
              import Application, { DOMBuilder, RuntimeCompilerLoader, SyncRenderer } from '@glimmer/application';
              import { ComponentManager, setPropertyDidChange } from '@glimmer/component';
              import Resolver, { BasicModuleRegistry } from '@glimmer/resolver';
              import moduleMap from '../config/module-map';
              import resolverConfiguration from '../config/resolver-configuration';

              exports = function(document) {
                let moduleRegistry = new BasicModuleRegistry(moduleMap);
                let resolver = new Resolver(resolverConfiguration, moduleRegistry);

                const app = new Application({
                  document,
                  builder: new DOMBuilder({ element: document.body, nextSibling: null }),
                  loader: new RuntimeCompilerLoader(resolver),
                  renderer: new SyncRenderer(),
                  resolver,
                  rootName: resolverConfiguration.app.rootName,
                });

                app.registerInitializer({
                  initialize(registry) {
                    registry.register(\`component-manager:/\${app.rootName}/component-managers/main\`, ComponentManager);
                  },
                });

                return app;
              };
            `,
            'ui': {
              'index.html': 'src',
              'components': {
                'App': {
                  'template.hbs': `<div>Hello!</div>`,
                  'component.ts': `import Component from "@glimmer/component"; export default class extends Component { };`
                }
              }
            },
          },
          'tsconfig.json': tsconfigContents
        });

        let app = createApp({
          trees: {
            nodeModules: path.join(__dirname, '..', '..', '..', 'node_modules')
          }
        });

        app.getRegistry().add('glimmer-ast-plugin', function (): ASTPlugin {
          return {
            name: 'test-plugin',
            visitor: {
              ElementNode(node: AST.ElementNode) {
                node.tag = 'span';
              }
            }
          }
        });

        let output = await buildOutput(app.toTree());

        let actual = output.read();
        let buildApp = evalModule(actual['app.js'] as string);
        let doc = new SimpleDOM.Document();
        let glimmerApp = buildApp(doc);

        glimmerApp.renderComponent('App', doc.body, null);
        await glimmerApp.boot();
        let serializer = new SimpleDOM.HTMLSerializer(SimpleDOM.voidMap);
        let html = serializer.serializeChildren(doc.body as any).trim();
        expect(html).to.deep.equal(stripIndent`<span>Hello!</span><!---->`);
      });
    });
  });
});

function evalModule(source: string): any {
  const wrapper = `(function(exports) { ${source}; return exports; })`;
  const func = eval(wrapper);
  const moduleExports = func({});

  return moduleExports;
}