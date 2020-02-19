(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const { app, dialog, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const https = require('https');
const platform = require('os').platform();
const crypto = require('crypto');
const Store = require('electron-store');
const settings = new Store({ name: 'Settings' });
const log = require('electron-log');
const splash = require('@trodi/electron-splashscreen');
const config = require('./src/js/ws_config');

const IS_DEV = (process.argv[1] === 'dev' || process.argv[2] === 'dev');
const IS_DEBUG = IS_DEV || process.argv[1] === 'debug' || process.argv[2] === 'debug';
const LOG_LEVEL = IS_DEBUG ? 'debug' : 'warn';
const WALLET_CFGFILE = path.join(app.getPath('userData'), 'wconfig.txt');

const WALLETSHELL_VERSION = app.getVersion() || '0.3.x';
const SERVICE_FILENAME = (platform === 'win32' ? `${config.walletServiceBinaryFilename}.exe` : config.walletServiceBinaryFilename);
const SERVICE_OSDIR = (platform === 'win32' ? 'win' : (platform === 'darwin' ? 'osx' : 'lin'));
const DEFAULT_SERVICE_BIN = path.join(process.resourcesPath, 'bin', SERVICE_OSDIR, SERVICE_FILENAME);

const DEFAULT_REMOTE_NODE = config.remoteNodeListFallback
    .map((a) => ({ sort: Math.random(), value: a }))
    .sort((a, b) => a.sort - b.sort)
    .map((a) => a.value)[0];

const DEFAULT_SETTINGS = {
    service_bin: DEFAULT_SERVICE_BIN,
    service_host: '127.0.0.1',
    service_port: config.walletServiceRpcPort,
    service_password: 'passwrd',
    service_timeout: 30,
    node_address: DEFAULT_REMOTE_NODE,
    pubnodes_last_updated: 946697799000,
    pubnodes_data: config.remoteNodeListFallback,
    pubnodes_custom: ['127.0.0.1:11898'],
    pubnodes_exclude_offline: false,
    tray_minimize: false,
    tray_close: false,
    darkmode: true,
    service_config_format: config.walletServiceConfigFormat
};
const DEFAULT_SIZE = { width: 840, height: 680 };
const WIN_TITLE = `${config.appName} ${WALLETSHELL_VERSION} - ${config.appDescription}`;

app.prompExit = true;
app.prompShown = false;
app.needToExit = false;
app.debug = IS_DEBUG;
app.walletConfig = WALLET_CFGFILE;
app.publicNodesUpdated = false;
app.setAppUserModelId(config.appId);

log.transports.console.level = LOG_LEVEL;
log.transports.file.level = LOG_LEVEL;
log.transports.file.maxSize = 5 * 1024 * 1024;
log.info(`Starting WalletShell ${WALLETSHELL_VERSION}`);
if (IS_DEV || IS_DEBUG) log.warn(`Running in ${IS_DEV ? 'dev' : 'debug'} mode`);

let trayIcon = path.join(__dirname, 'src/assets/tray.png');
let trayIconHide = path.join(__dirname, 'src/assets/trayon.png');

let win;
let tray;

function createWindow() {
    // Create the browser window.
    let darkmode = settings.get('darkmode', true);
    let bgColor = darkmode ? '#000000' : '#02853E';

    const winOpts = {
        title: WIN_TITLE,
        icon: path.join(__dirname, 'src/assets/walletshell_icon.png'),
        frame: true,
        width: DEFAULT_SIZE.width,
        height: DEFAULT_SIZE.height,
        minWidth: DEFAULT_SIZE.width,
        minHeight: DEFAULT_SIZE.height,
        show: false,
        backgroundColor: bgColor,
        center: true,
        autoHideMenuBar: false,
        menuBarVisibility: false,
        webPreferences: {
            nativeWindowOpen: true,
            nodeIntegrationInWorker: true,
        },
    };

    win = splash.initSplashScreen({
        windowOpts: winOpts,
        templateUrl: path.join(__dirname, "src/html/splash.html"),
        delay: 0,
        minVisible: 800,
        splashScreenOpts: {
            width: 425,
            height: 325,
            transparent: true
        },
    });

    //load the index.html of the app.
    win.loadURL(url.format({
        pathname: path.join(__dirname, 'src/html/index.html'),
        protocol: 'file:',
        slashes: true
    }));

    // open devtools
    if (IS_DEV) win.webContents.openDevTools();

    // show windosw
    win.once('ready-to-show', () => {
        //win.show();
        win.setTitle(WIN_TITLE);
        if (platform !== 'darwin') {
            tray.setToolTip(config.appSlogan);
        }
    });

    win.on('close', (e) => {
        if ((settings.get('tray_close') && !app.needToExit && platform !== 'darwin')) {
            e.preventDefault();
            win.hide();
        } else if (app.prompExit) {
            e.preventDefault();
            if (app.prompShown) return;
            let msg = 'Are you sure want to exit?';
            app.prompShown = true;
            dialog.showMessageBox({
                type: 'question',
                buttons: ['Yes', 'No'],
                title: 'Exit Confirmation',
                message: msg
            }, function (response) {
                app.prompShown = false;
                if (response === 0) {
                    app.prompExit = false;
                    win.webContents.send('cleanup', 'Clean it up, Dad!');
                } else {
                    app.prompExit = true;
                    app.needToExit = false;
                }
            });
        }
    });

    if (platform !== 'darwin') {
        let contextMenu = Menu.buildFromTemplate([
            { label: 'Minimize to tray', click: () => { win.hide(); } },
            {
                label: 'Quit', click: () => {
                    app.needToExit = true;
                    if (win) {
                        win.close();
                    } else {
                        process.exit(0);
                    }
                }
            }
        ]);

        tray = new Tray(trayIcon);
        tray.setPressedImage(trayIconHide);
        tray.setTitle(config.appName);
        tray.setToolTip(config.appSlogan);
        tray.setContextMenu(contextMenu);


        tray.on('click', () => {
            if (!win.isFocused() && win.isVisible()) {
                win.focus();
            } else if (settings.get('tray_minimize', false)) {
                if (win.isVisible()) {
                    win.hide();
                } else {
                    win.show();
                }
            } else {
                if (win.isMinimized()) {
                    win.restore();
                    win.focus();
                } else {
                    win.minimize();
                }
            }
        });

        win.on('show', () => {
            tray.setHighlightMode('always');
            tray.setImage(trayIcon);
            contextMenu = Menu.buildFromTemplate([
                { label: 'Minimize to tray', click: () => { win.hide(); } },
                {
                    label: 'Quit', click: () => {
                        app.needToExit = true;
                        win.close();
                    }
                }
            ]);
            tray.setContextMenu(contextMenu);
            tray.setToolTip(config.appSlogan);
        });

        win.on('hide', () => {
            tray.setHighlightMode('never');
            tray.setImage(trayIconHide);
            if (platform === 'darwin') return;

            contextMenu = Menu.buildFromTemplate([
                { label: 'Restore', click: () => { win.show(); } },
                {
                    label: 'Quit', click: () => {
                        app.needToExit = true;
                        win.close();
                    }
                }
            ]);
            tray.setContextMenu(contextMenu);
        });

        win.on('minimize', (event) => {
            if (settings.get('tray_minimize') && platform !== 'darwin') {
                event.preventDefault();
                win.hide();
            }
        });
    }

    win.on('closed', () => {
        win = null;
    });

    win.setMenu(null);

    // misc handler
    win.webContents.on('crashed', () => {
        // todo: prompt to restart
        log.debug('webcontent was crashed');
    });

    win.on('unresponsive', () => {
        // todo: prompt to restart
        log.debug('webcontent is unresponsive');
    });
}

function storeNodeList(pnodes) {
    if(!pnodes) return;

    if(!pnodes.length) return;

    let validNodes = [];
    pnodes.forEach(node => {
        if(node.hasOwnProperty('cache')) {
            if (!config.remoteNodeCacheSupported && true === node.cache) {
                return;
            }
        }
        if(node.hasOwnProperty('ssl')) {
            if (!config.remoteNodeSslSupported && true === node.ssl) {
                return;
            }
        }
        
        let item = `${node.url}:${node.port}`;
        validNodes.push(item);
    });
    settings.set('pubnodes_data', validNodes);
}

function doNodeListUpdate() {
    try {
        https.get(config.remoteNodeListUpdateUrl, (res) => {
            var result = '';
            res.setEncoding('utf8');

            res.on('data', (chunk) => {
                result += chunk;
            });

            res.on('end', () => {
                try {
                    var pnodes = JSON.parse(result);
                    if(pnodes.hasOwnProperty('nodes')) {
                        pnodes = pnodes.nodes;
                    }
                    storeNodeList(pnodes);
                    if(result.length) settings.set('pubnodes_raw', Buffer.from(result).toString('base64'));
                    settings.set('pubnodes_last_updated', new Date().getTime());
                    settings.delete('pubnodes_tested');
                    log.debug('Public node list has been updated');
                } catch (e) {
                    log.debug(`Failed to update public node list: ${e.message}`);
                    storeNodeList(false);
                }
            });
        }).on('error', (e) => {
            log.debug(`Failed to update public-node list: ${e.message}`);
            storeNodeList(false);
        });
    } catch (e) {
        log.error(`Failed to update public-node list: ${e.code} - ${e.message}`);
        storeNodeList(false);
    }
}

function updatePublicNodes() {
    if (config.remoteNodeListUpdateUrl) {
        let last_updated = settings.get('pubnodes_last_updated', 946697799000);
        let now = new Date().getTime();
        if (Math.abs(now - last_updated) / 36e5 >= 24) {
            //do update
            log.info('Performing daily public-node list update.');
            doNodeListUpdate();
        } else {
            log.info('Public node list up to date, skipping update');
            storeNodeList(false); // from local cache
        }
    }
}

function serviceBinCheck() {
    if (DEFAULT_SERVICE_BIN.startsWith('/tmp')) {
        log.warn(`AppImage env, copying service bin file`);
        let targetPath = path.join(app.getPath('userData'), SERVICE_FILENAME);
        try {
            fs.renameSync(targetPath, `${targetPath}.bak`, (err) => {
                if (err) log.error(err);
            });
        } catch (_e) { }

        try {
            fs.copyFile(DEFAULT_SERVICE_BIN, targetPath, (err) => {
                if (err) {
                    log.error(err);
                    return;
                }
                settings.set('service_bin', targetPath);
                log.debug(`service binary copied to ${targetPath}`);
            });
        } catch (_e) { }
    } else {
        // don't trust user's settings, recheck
        let svcbin = settings.get('service_bin');
        try {
            if (!fs.existsSync(svcbin)) {
                log.warn(`Service binary can't be found, falling back to default`);
                settings.set('service_bin', DEFAULT_SERVICE_BIN);
            } else {
                log.info('Service binary found');
            }
        } catch (_e) {
            log.warn('Failed to check for service binary path, falling back to default');
            settings.set('service_bin', DEFAULT_SERVICE_BIN);
        }
    }
}

function initSettings() {
    Object.keys(DEFAULT_SETTINGS).forEach((k) => {
        if (!settings.has(k) || settings.get(k) === null) {
            settings.set(k, DEFAULT_SETTINGS[k]);
        }
    });
    settings.set('service_password', crypto.randomBytes(32).toString('hex'));
    settings.set('version', WALLETSHELL_VERSION);
    serviceBinCheck();
    fs.unlink(WALLET_CFGFILE, (err) => {
        if (err) log.debug(err.code === 'ENOENT' ? 'No stalled wallet config' : err.message);
    });
}

app.on('browser-window-created', function (e, window) {
    window.setMenuBarVisibility(false);
    window.setAutoHideMenuBar(false);
});
// Quit when all windows are closed.
app.on('window-all-closed', () => {
    //if (platform !== 'darwin')
    app.quit();
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) createWindow();
});

process.on('uncaughtException', function (e) {
    log.error(`Uncaught exception: ${e.message}`);
    try { fs.unlinkSync(WALLET_CFGFILE); } catch (e) { }
    process.exit(1);
});

process.on('beforeExit', (code) => {
    log.debug(`beforeExit code: ${code}`);
});

process.on('exit', (code) => {
    // just to be sure
    try { fs.unlinkSync(WALLET_CFGFILE); } catch (e) { }
    log.debug(`exit with code: ${code}`);
});

process.on('warning', (warning) => {
    log.warn(`${warning.code}, ${warning.name}`);
});

const silock = app.requestSingleInstanceLock();
app.on('second-instance', () => {
    if (win) {
        if (!win.isVisible()) win.show();
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});
if (!silock) app.quit();

app.on('ready', () => {
    initSettings();
    updatePublicNodes();
    createWindow();
    // try to target center pos of primary display
    let eScreen = require('electron').screen;
    let primaryDisp = eScreen.getPrimaryDisplay();
    let tx = Math.ceil((primaryDisp.workAreaSize.width - DEFAULT_SIZE.width) / 2);
    let ty = Math.ceil((primaryDisp.workAreaSize.height - (DEFAULT_SIZE.height)) / 2);
    if (tx > 0 && ty > 0) {
        try { win.setPosition(parseInt(tx, 10), parseInt(ty, 10)); } catch (_e) { }
    }

    // remove old settings cruft if exist
    setTimeout(() => {
        try { settings.delete('pubnodes_checked'); } catch (e) { }
        try { settings.delete('pubnodes_date'); } catch (e) { }
    }, 2500);
});
},{"./src/js/ws_config":38,"@trodi/electron-splashscreen":2,"crypto":undefined,"electron":18,"electron-log":5,"electron-store":17,"fs":undefined,"https":undefined,"os":undefined,"path":undefined,"url":undefined}],2:[function(require,module,exports){
"use strict";
/**
 * Module handles configurable splashscreen to show while app is loading.
 */
Object.defineProperty(exports, "__esModule", { value: true });
var electron_1 = require("electron");
/**
 * When splashscreen was shown.
 * @private
 */
var splashScreenTimestamp = 0;
/**
 * Splashscreen is loaded and ready to show.
 * @private
 */
var splashScreenReady = false;
/**
 * Main window has been loading for a min amount of time.
 * @private
 */
var slowStartup = false;
/**
 * Show splashscreen if criteria are met.
 * @private
 */
var showSplash = function () {
    if (splashScreen && splashScreenReady && slowStartup) {
        splashScreen.show();
        splashScreenTimestamp = Date.now();
    }
};
/**
 * Close splashscreen / show main screen. Ensure screen is visible for a min amount of time.
 * @private
 */
var closeSplashScreen = function (main, min) {
    if (splashScreen) {
        var timeout = min - (Date.now() - splashScreenTimestamp);
        setTimeout(function () {
            if (splashScreen) {
                splashScreen.close();
                splashScreen = null;
            }
            main.show();
        }, timeout);
    }
};
/**
 * The actual splashscreen browser window.
 * @private
 */
var splashScreen;
/**
 * Initializes a splashscreen that will show/hide smartly (and handle show/hiding of main window).
 * @param config - Configures splashscren
 * @returns {BrowserWindow} the main browser window ready for loading
 */
exports.initSplashScreen = function (config) {
    var xConfig = {
        delay: config.delay === undefined ? 500 : config.delay,
        minVisible: config.minVisible === undefined ? 500 : config.minVisible,
        windowOpts: config.windowOpts,
        templateUrl: config.templateUrl,
        splashScreenOpts: config.splashScreenOpts,
    };
    xConfig.splashScreenOpts.frame = false;
    xConfig.splashScreenOpts.center = true;
    xConfig.splashScreenOpts.show = false;
    xConfig.windowOpts.show = false;
    var window = new electron_1.BrowserWindow(xConfig.windowOpts);
    splashScreen = new electron_1.BrowserWindow(xConfig.splashScreenOpts);
    splashScreen.loadURL("file://" + xConfig.templateUrl);
    // Splashscreen is fully loaded and ready to view.
    splashScreen.webContents.on("did-finish-load", function () {
        splashScreenReady = true;
        showSplash();
    });
    // Startup is taking enough time to show a splashscreen.
    setTimeout(function () {
        slowStartup = true;
        showSplash();
    }, xConfig.delay);
    window.webContents.on("did-finish-load", function () {
        closeSplashScreen(window, xConfig.minVisible);
    });
    return window;
};
/**
 * Initializes a splashscreen that will show/hide smartly (and handle show/hiding of main window).
 * Use this function if you need to send/receive info to the splashscreen (e.g., you want to send
 * IPC messages to the splashscreen to inform the user of the app's loading state).
 * @param config - Configures splashscren
 * @returns {DynamicSplashScreen} the main browser window and the created splashscreen
 */
exports.initDynamicSplashScreen = function (config) {
    return {
        main: exports.initSplashScreen(config),
        // initSplashScreen initializes splashscreen so this is a safe cast.
        splashScreen: splashScreen,
    };
};

},{"electron":18}],3:[function(require,module,exports){
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const EventEmitter = require('events');
const dotProp = require('dot-prop');
const makeDir = require('make-dir');
const pkgUp = require('pkg-up');
const envPaths = require('env-paths');
const writeFileAtomic = require('write-file-atomic');

const plainObject = () => Object.create(null);

// Prevent caching of this module so module.parent is always accurate
delete require.cache[__filename];
const parentDir = path.dirname((module.parent && module.parent.filename) || '.');

class Conf {
	constructor(options) {
		const pkgPath = pkgUp.sync(parentDir);

		options = Object.assign({
			// Can't use `require` because of Webpack being annoying:
			// https://github.com/webpack/webpack/issues/196
			projectName: pkgPath && JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name
		}, options);

		if (!options.projectName && !options.cwd) {
			throw new Error('Project name could not be inferred. Please specify the `projectName` option.');
		}

		options = Object.assign({
			configName: 'config',
			fileExtension: 'json'
		}, options);

		if (!options.cwd) {
			options.cwd = envPaths(options.projectName).config;
		}

		this.events = new EventEmitter();
		this.encryptionKey = options.encryptionKey;
		this.path = path.resolve(options.cwd, `${options.configName}.${options.fileExtension}`);

		const fileStore = this.store;
		const store = Object.assign(plainObject(), options.defaults, fileStore);
		try {
			assert.deepEqual(fileStore, store);
		} catch (e) {
			this.store = store;
		}
	}

	get(key, defaultValue) {
		return dotProp.get(this.store, key, defaultValue);
	}

	set(key, value) {
		if (typeof key !== 'string' && typeof key !== 'object') {
			throw new TypeError(`Expected \`key\` to be of type \`string\` or \`object\`, got ${typeof key}`);
		}

		if (typeof key !== 'object' && value === undefined) {
			throw new TypeError('Use `delete()` to clear values');
		}

		const {store} = this;

		if (typeof key === 'object') {
			for (const k of Object.keys(key)) {
				dotProp.set(store, k, key[k]);
			}
		} else {
			dotProp.set(store, key, value);
		}

		this.store = store;
	}

	has(key) {
		return dotProp.has(this.store, key);
	}

	delete(key) {
		const {store} = this;
		dotProp.delete(store, key);
		this.store = store;
	}

	clear() {
		this.store = plainObject();
	}

	onDidChange(key, callback) {
		if (typeof key !== 'string') {
			throw new TypeError(`Expected \`key\` to be of type \`string\`, got ${typeof key}`);
		}

		if (typeof callback !== 'function') {
			throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof callback}`);
		}

		let currentValue = this.get(key);

		const onChange = () => {
			const oldValue = currentValue;
			const newValue = this.get(key);

			try {
				// TODO: Use `util.isDeepStrictEqual` when targeting Node.js 10
				assert.deepEqual(newValue, oldValue);
			} catch (_) {
				currentValue = newValue;
				callback.call(this, newValue, oldValue);
			}
		};

		this.events.on('change', onChange);
		return () => this.events.removeListener('change', onChange);
	}

	get size() {
		return Object.keys(this.store).length;
	}

	get store() {
		try {
			let data = fs.readFileSync(this.path, this.encryptionKey ? null : 'utf8');

			if (this.encryptionKey) {
				try {
					const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
					data = Buffer.concat([decipher.update(data), decipher.final()]);
				} catch (_) {}
			}

			return Object.assign(plainObject(), JSON.parse(data));
		} catch (error) {
			if (error.code === 'ENOENT') {
				makeDir.sync(path.dirname(this.path));
				return plainObject();
			}

			if (error.name === 'SyntaxError') {
				return plainObject();
			}

			throw error;
		}
	}

	set store(value) {
		// Ensure the directory exists as it could have been deleted in the meantime
		makeDir.sync(path.dirname(this.path));

		let data = JSON.stringify(value, null, '\t');

		if (this.encryptionKey) {
			const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
			data = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
		}

		writeFileAtomic.sync(this.path, data);
		this.events.emit('change');
	}

	// TODO: Use `Object.entries()` when targeting Node.js 8
	* [Symbol.iterator]() {
		const {store} = this;

		for (const key of Object.keys(store)) {
			yield [key, store[key]];
		}
	}
}

module.exports = Conf;

},{"assert":undefined,"crypto":undefined,"dot-prop":4,"env-paths":19,"events":undefined,"fs":undefined,"make-dir":27,"path":undefined,"pkg-up":33,"write-file-atomic":37}],4:[function(require,module,exports){
'use strict';
const isObj = require('is-obj');

function getPathSegments(path) {
	const pathArr = path.split('.');
	const parts = [];

	for (let i = 0; i < pathArr.length; i++) {
		let p = pathArr[i];

		while (p[p.length - 1] === '\\' && pathArr[i + 1] !== undefined) {
			p = p.slice(0, -1) + '.';
			p += pathArr[++i];
		}

		parts.push(p);
	}

	return parts;
}

module.exports = {
	get(obj, path, value) {
		if (!isObj(obj) || typeof path !== 'string') {
			return value === undefined ? obj : value;
		}

		const pathArr = getPathSegments(path);

		for (let i = 0; i < pathArr.length; i++) {
			if (!Object.prototype.propertyIsEnumerable.call(obj, pathArr[i])) {
				return value;
			}

			obj = obj[pathArr[i]];

			if (obj === undefined || obj === null) {
				// `obj` is either `undefined` or `null` so we want to stop the loop, and
				// if this is not the last bit of the path, and
				// if it did't return `undefined`
				// it would return `null` if `obj` is `null`
				// but we want `get({foo: null}, 'foo.bar')` to equal `undefined`, or the supplied value, not `null`
				if (i !== pathArr.length - 1) {
					return value;
				}

				break;
			}
		}

		return obj;
	},

	set(obj, path, value) {
		if (!isObj(obj) || typeof path !== 'string') {
			return obj;
		}

		const root = obj;
		const pathArr = getPathSegments(path);

		for (let i = 0; i < pathArr.length; i++) {
			const p = pathArr[i];

			if (!isObj(obj[p])) {
				obj[p] = {};
			}

			if (i === pathArr.length - 1) {
				obj[p] = value;
			}

			obj = obj[p];
		}

		return root;
	},

	delete(obj, path) {
		if (!isObj(obj) || typeof path !== 'string') {
			return;
		}

		const pathArr = getPathSegments(path);

		for (let i = 0; i < pathArr.length; i++) {
			const p = pathArr[i];

			if (i === pathArr.length - 1) {
				delete obj[p];
				return;
			}

			obj = obj[p];

			if (!isObj(obj)) {
				return;
			}
		}
	},

	has(obj, path) {
		if (!isObj(obj) || typeof path !== 'string') {
			return false;
		}

		const pathArr = getPathSegments(path);

		for (let i = 0; i < pathArr.length; i++) {
			if (isObj(obj)) {
				if (!(pathArr[i] in obj)) {
					return false;
				}

				obj = obj[pathArr[i]];
			} else {
				return false;
			}
		}

		return true;
	}
};

},{"is-obj":25}],5:[function(require,module,exports){
'use strict';

if (process.type === 'renderer') {
  module.exports = require('./renderer');
} else {
  module.exports = require('./main');
}
},{"./main":15,"./renderer":16}],6:[function(require,module,exports){
'use strict';

var util = require('util');
var EOL  = require('os').EOL;

module.exports = {
  format: format,
  formatTimeZone: formatTimeZone,
  pad: pad,
  stringifyArray: stringifyArray
};

function format(msg, formatter) {
  if (typeof formatter === 'function') {
    return formatter(msg);
  }

  var date = msg.date;

  return formatter
    .replace('{level}', msg.level)
    .replace('{text}', stringifyArray(msg.data))
    .replace('{y}', date.getFullYear())
    .replace('{m}', pad(date.getMonth() + 1))
    .replace('{d}', pad(date.getDate()))
    .replace('{h}', pad(date.getHours()))
    .replace('{i}', pad(date.getMinutes()))
    .replace('{s}', pad(date.getSeconds()))
    .replace('{ms}', pad(date.getMilliseconds(), 3))
    .replace('{z}', formatTimeZone(date.getTimezoneOffset()));
}

function stringifyArray(data) {
  data = data.map(function formatErrors(arg) {
    return arg instanceof Error ? arg.stack + EOL : arg;
  });
  return util.format.apply(util, data);
}

function pad(number, zeros) {
  zeros = zeros || 2;
  return (new Array(zeros + 1).join('0') + number).substr(-zeros, zeros);
}

function formatTimeZone(minutesOffset) {
  var m = Math.abs(minutesOffset);
  return (minutesOffset >= 0 ? '-' : '+') +
    pad(Math.floor(m / 60)) + ':' +
    pad(m % 60);
}

},{"os":undefined,"util":undefined}],7:[function(require,module,exports){
// jshint -W040
'use strict';

var LEVELS = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'];

module.exports = log;

function log(transports, level, text) {
  var data = Array.prototype.slice.call(arguments, 2);

  var msg = {
    data: data,
    date: new Date(),
    level: level
  };

  for (var i in transports) {
    // jshint -W089
    if (!transports.hasOwnProperty(i) || typeof transports[i] !== 'function') {
      continue;
    }

    var transport = transports[i];

    if (transport === false || !compareLevels(transport.level, level)) {
      continue;
    }

    if (transport.level === false) continue;

    transport.call(null, msg);
  }
}

function compareLevels(passLevel, checkLevel) {
  var pass = LEVELS.indexOf(passLevel);
  var check = LEVELS.indexOf(checkLevel);
  if (check === -1 || pass === -1) {
    return true;
  }
  return check <= pass;
}
},{}],8:[function(require,module,exports){
'use strict';

/**
 * Save console methods for using when originals are overridden
 */
module.exports = {
  context: console,
  error:   console.error,
  warn:    console.warn,
  info:    console.info,
  verbose: console.verbose,
  debug:   console.debug,
  silly:   console.silly,
  log:     console.log
};

},{}],9:[function(require,module,exports){
'use strict';

var format          = require('../format');
var originalConsole = require('../original-console');

transport.level  = 'silly';
transport.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

module.exports = transport;

function transport(msg) {
  var text = format.format(msg, transport.format);
  if (originalConsole[msg.level]) {
    originalConsole[msg.level](text);
  } else {
    originalConsole.log(text);
  }
}


},{"../format":6,"../original-console":8}],10:[function(require,module,exports){
'use strict';

var fs   = require('fs');
var path = require('path');
var os   = require('os');
var getAppName = require('./get-app-name');

module.exports = findLogPath;

/**
 * Try to determine a platform-specific path where can write logs
 * @param {string} [appName] Used to determine the last part of a log path
 * @return {string|boolean}
 */
function findLogPath(appName) {
  appName = appName || getAppName();
  if (!appName) {
    return false;
  }

  var homeDir = os.homedir ? os.homedir() : process.env['HOME'];
  
  var dir;
  switch (process.platform) {
    case 'linux': {
      dir = prepareDir(process.env['XDG_CONFIG_HOME'], appName)
        .or(homeDir, '.config', appName)
        .or(process.env['XDG_DATA_HOME'], appName)
        .or(homeDir, '.local', 'share', appName)
        .result;
      break;
    }

    case 'darwin': {
      dir = prepareDir(homeDir, 'Library', 'Logs', appName)
        .or(homeDir, 'Library', 'Application Support', appName)
        .result;
      break;
    }

    case 'win32': {
      dir = prepareDir(process.env['APPDATA'], appName)
        .or(homeDir, 'AppData', 'Roaming', appName)
        .result;
      break;
    }
  }

  if (dir) {
    return path.join(dir, 'log.log');
  } else {
    return false;
  }
}



function prepareDir(dirPath) {
  // jshint -W040
  if (!this || this.or !== prepareDir || !this.result) {
    if (!dirPath) {
      return { or: prepareDir };
    }

    //noinspection JSCheckFunctionSignatures
    dirPath = path.join.apply(path, arguments);
    mkDir(dirPath);

    try {
      fs.accessSync(dirPath, fs.W_OK);
    } catch (e) {
      return { or: prepareDir };
    }
  }

  return {
    or: prepareDir,
    result: (this ? this.result : false) || dirPath
  };
}

function mkDir(dirPath, root) {
  var dirs = dirPath.split(path.sep);
  var dir = dirs.shift();
  root = (root || '') + dir + path.sep;

  try {
    fs.mkdirSync(root);
  } catch (e) {
    if (!fs.statSync(root).isDirectory()) {
      throw new Error(e);
    }
  }

  return !dirs.length || mkDir(dirs.join(path.sep), root);
}

},{"./get-app-name":11,"fs":undefined,"os":undefined,"path":undefined}],11:[function(require,module,exports){
// jshint -W074
'use strict';

/** @name process.resourcesPath */

var fs   = require('fs');
var path = require('path');
var consoleTransport = require('../console');

module.exports = getAppName;

function getAppName() {
  try {
    var name = loadPackageName();
    if (name) {
      return name;
    }
    return warn('electron-log: unable to load the app name from package.json');
  } catch (e) {
    return warn('electron-log: ' + e.message);
  }
}

/**
 * Try to load main app package
 * @throws {Error}
 * @return {Object|null}
 */
function loadPackageName() {
  var packageFile;

  try {
    if (require.main.filename) {
      packageFile = find(path.dirname(require.main.filename));
    }
  } catch (e) {}

  if (!packageFile && process.resourcesPath) {
    packageFile = find(path.join(process.resourcesPath, 'app.asar'));
    var electronModule = path.join('node_modules', 'electron', 'package.json');
    if (packageFile && packageFile.indexOf(electronModule) !== -1) {
      packageFile = null;
    }
  }

  if (!packageFile) {
    packageFile = find(process.cwd());
  }

  if (!packageFile) {
    return null;
  }

  var content = fs.readFileSync(packageFile, 'utf-8');
  var packageData = JSON.parse(content);

  //noinspection JSUnresolvedVariable
  return packageData ? packageData.productName || packageData.name : false;
}

function find(root) {
  var file;

  while (!file) {
    var parent;
    file = path.join(root, 'package.json');

    try {
      fs.statSync(file);
    } catch (e) {
      parent = path.resolve(root, '..');
      file = null;
    }

    if (root === parent) {
      break;
    }

    root = parent;
  }

  return file;
}

function warn(message) {
  consoleTransport({
    data: [message],
    date: new Date(),
    level: 'warn'
  });
}
},{"../console":9,"fs":undefined,"path":undefined}],12:[function(require,module,exports){
'use strict';

var fs               = require('fs');
var EOL              = require('os').EOL;
var format           = require('../../format');
var consoleTransport = require('../console');
var findLogPath      = require('./find-log-path');

transport.findLogPath  = findLogPath;
transport.format       = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
transport.level        = 'warn';
transport.maxSize      = 1024 * 1024;
transport.streamConfig = undefined;

module.exports = transport;

function transport(msg) {
  var text = format.format(msg, transport.format) + EOL;

  if (transport.stream === undefined) {
    initSteamConfig();
    openStream();
  }

  if (transport.level === false) {
    return;
  }

  var needLogRotation = transport.maxSize > 0 &&
    getStreamSize(transport.stream) > transport.maxSize;

  if (needLogRotation) {
    archiveLog(transport.stream);
    openStream();
  }

  transport.stream.write(text);
}

function initSteamConfig() {
  transport.file = transport.file || findLogPath(transport.appName);

  if (!transport.file) {
    transport.level = false;
    logConsole('Could not set a log file');
  }
}

function openStream() {
  if (transport.level === false) {
    return;
  }

  transport.stream = fs.createWriteStream(
    transport.file,
    transport.streamConfig || { flags: 'a' }
  );
}

function getStreamSize(stream) {
  if (!stream) {
    return 0;
  }

  if (stream.logSizeAtStart === undefined) {
    try {
      stream.logSizeAtStart = fs.statSync(stream.path).size;
    } catch (e) {
      stream.logSizeAtStart = 0;
    }
  }

  return stream.logSizeAtStart + stream.bytesWritten;
}

function archiveLog(stream) {
  if (stream.end) {
    stream.end();
  }

  try {
    fs.renameSync(stream.path, stream.path.replace(/log$/, 'old.log'));
  } catch (e) {
    logConsole('Could not rotate log', e);
  }
}

function logConsole(message, error) {
  var data = ['electron-log.transports.file: ' + message];

  if (error) {
    data.push(error);
  }

  consoleTransport({ data: data, date: new Date(), level: 'warn' });
}

},{"../../format":6,"../console":9,"./find-log-path":10,"fs":undefined,"os":undefined}],13:[function(require,module,exports){
// jshint -W074, -W089
'use strict';

var http  = require('http');
var https = require('https');
var url   = require('url');

transport.client = { name: 'electron-application' };
transport.depth  = 6;
transport.level  = false;
transport.url    = null;

module.exports = transport;

function transport(msg) {
  if (!transport.url) return;

  var data = jsonDepth({
    client: transport.client,
    data: msg.data,
    date: msg.date.getTime(),
    level: msg.level
  }, transport.depth + 1);

  post(transport.url, data);
}

function post(serverUrl, data) {
  var urlObject = url.parse(serverUrl);
  var transport = urlObject.protocol === 'https:' ? https : http;

  var body = JSON.stringify(data);

  var options = {
    hostname: urlObject.hostname,
    port:     urlObject.port,
    path:     urlObject.path,
    method:   'POST',
    headers:  {
      'Content-Type':  'application/json',
      'Content-Length': body.length
    }
  };

  var request = transport.request(options);
  request.write(body);
  request.end();
}

function jsonDepth(json, depth) {
  if (depth < 1) {
    if (Array.isArray(json))  return '[array]';
    if (typeof json === 'object')  return '[object]';
    return json;
  }

  if (Array.isArray(json)) {
    return json.map(function(child) {
      return jsonDepth(child, depth - 1);
    });
  }

  if (json && typeof json.getMonth === 'function') {
    return json;
  }

  if (json === null) {
    return null;
  }

  if (typeof json === 'object') {
    if (typeof json.toJSON === 'function') {
      json = json.toJSON();
    }

    var newJson = {};
    for (var i in json) {
      //noinspection JSUnfilteredForInLoop
      newJson[i] = jsonDepth(json[i], depth - 1);
    }

    return newJson;
  }

  return json;
}
},{"http":undefined,"https":undefined,"url":undefined}],14:[function(require,module,exports){
'use strict';

var BrowserWindow;
try {
  BrowserWindow = require('electron').BrowserWindow;
} catch (e) {
  BrowserWindow = null;
}

var format = require('../format');

transport.level  = BrowserWindow ? 'silly' : false;
transport.format = '[{h}:{i}:{s}.{ms}] {text}';

module.exports = transport;

function transport(msg) {
  if (!BrowserWindow) return;

  var text = format.format(msg, transport.format);
  BrowserWindow.getAllWindows().forEach(function(wnd) {
    wnd.webContents.send('__ELECTRON_LOG_RENDERER__', msg.level, text);
  });
}

},{"../format":6,"electron":18}],15:[function(require,module,exports){
'use strict';

var electron;
try {
  electron = require('electron');
} catch (e) {
  electron = null;
}

var log                      = require('./lib/log');
var transportConsole         = require('./lib/transports/console');
var transportFile            = require('./lib/transports/file');
var transportLogS            = require('./lib/transports/log-s');
var transportRendererConsole = require('./lib/transports/renderer-console');

var transports = {
  console: transportConsole,
  file: transportFile,
  logS: transportLogS,
  rendererConsole: transportRendererConsole
};

module.exports = {
  transports: transports,

  error:   log.bind(null, transports, 'error'),
  warn:    log.bind(null, transports, 'warn'),
  info:    log.bind(null, transports, 'info'),
  verbose: log.bind(null, transports, 'verbose'),
  debug:   log.bind(null, transports, 'debug'),
  silly:   log.bind(null, transports, 'silly'),
  log:     log.bind(null, transports, 'info')
};

module.exports.default = module.exports;

if (electron && electron.ipcMain) {
  electron.ipcMain.on('__ELECTRON_LOG__', onRendererLog);
  var appName = electron.app.getName();
  if (appName !== 'Electron') {
    transportFile.appName = appName;
  }
}

function onRendererLog(event, data) {
  if (Array.isArray(data)) {
    data.unshift(transports);
    log.apply(null, data);
  }
}

},{"./lib/log":7,"./lib/transports/console":9,"./lib/transports/file":12,"./lib/transports/log-s":13,"./lib/transports/renderer-console":14,"electron":18}],16:[function(require,module,exports){
'use strict';

module.exports = null;

var ipcRenderer;
try {
  ipcRenderer = require('electron').ipcRenderer;
} catch (e) {
  ipcRenderer = null;
}

var originalConsole = require('./lib/original-console');

if (ipcRenderer) {
  module.exports = {
    error:   log.bind(null, 'error'),
    warn:    log.bind(null, 'warn'),
    info:    log.bind(null, 'info'),
    verbose: log.bind(null, 'verbose'),
    debug:   log.bind(null, 'debug'),
    silly:   log.bind(null, 'silly'),
    log:     log.bind(null, 'info')
  };

  module.exports.default = module.exports;

  ipcRenderer.on('__ELECTRON_LOG_RENDERER__', function(event, level, data) {
    if (level === 'verbose') {
      level = 'log';
    } else if (level === 'silly') {
      level = 'debug';
    }

    originalConsole[level].apply(
      originalConsole.context,
      typeof data === 'string' ? [data] : data
    );
  });
}

function log() {
  var data = Array.prototype.slice.call(arguments);

  data = data.map(function(obj) {
    if (obj instanceof Error) {
      obj = obj.stack || obj;
    }

    return obj;
  });

  ipcRenderer.send('__ELECTRON_LOG__', data);
}

},{"./lib/original-console":8,"electron":18}],17:[function(require,module,exports){
'use strict';
const path = require('path');
const electron = require('electron');
const Conf = require('conf');

class ElectronStore extends Conf {
	constructor(opts) {
		const defaultCwd = (electron.app || electron.remote.app).getPath('userData');

		opts = Object.assign({name: 'config'}, opts);

		if (opts.cwd) {
			opts.cwd = path.isAbsolute(opts.cwd) ? opts.cwd : path.join(defaultCwd, opts.cwd);
		} else {
			opts.cwd = defaultCwd;
		}

		opts.configName = opts.name;
		delete opts.name;
		super(opts);
	}

	openInEditor() {
		electron.shell.openItem(this.path);
	}
}

module.exports = ElectronStore;

},{"conf":3,"electron":18,"path":undefined}],18:[function(require,module,exports){
var fs = require('fs')
var path = require('path')

var pathFile = path.join(__dirname, 'path.txt')

function getElectronPath () {
  if (fs.existsSync(pathFile)) {
    var executablePath = fs.readFileSync(pathFile, 'utf-8')
    if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
      return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath)
    }
    return path.join(__dirname, 'dist', executablePath)
  } else {
    throw new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again')
  }
}

module.exports = getElectronPath()

},{"fs":undefined,"path":undefined}],19:[function(require,module,exports){
'use strict';
const path = require('path');
const os = require('os');

const homedir = os.homedir();
const tmpdir = os.tmpdir();
const env = process.env;

const macos = name => {
	const library = path.join(homedir, 'Library');

	return {
		data: path.join(library, 'Application Support', name),
		config: path.join(library, 'Preferences', name),
		cache: path.join(library, 'Caches', name),
		log: path.join(library, 'Logs', name),
		temp: path.join(tmpdir, name)
	};
};

const windows = name => {
	const appData = env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');

	return {
		// data/config/cache/log are invented by me as Windows isn't opinionated about this
		data: path.join(appData, name, 'Data'),
		config: path.join(appData, name, 'Config'),
		cache: path.join(appData, name, 'Cache'),
		log: path.join(appData, name, 'Log'),
		temp: path.join(tmpdir, name)
	};
};

// https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
const linux = name => {
	const username = path.basename(homedir);

	return {
		data: path.join(env.XDG_DATA_HOME || path.join(homedir, '.local', 'share'), name),
		config: path.join(env.XDG_CONFIG_HOME || path.join(homedir, '.config'), name),
		cache: path.join(env.XDG_CACHE_HOME || path.join(homedir, '.cache'), name),
		// https://wiki.debian.org/XDGBaseDirectorySpecification#state
		log: path.join(env.XDG_STATE_HOME || path.join(homedir, '.local', 'state'), name),
		temp: path.join(tmpdir, username, name)
	};
};

module.exports = (name, opts) => {
	if (typeof name !== 'string') {
		throw new TypeError(`Expected string, got ${typeof name}`);
	}

	opts = Object.assign({suffix: 'nodejs'}, opts);

	if (opts.suffix) {
		// add suffix to prevent possible conflict with native apps
		name += `-${opts.suffix}`;
	}

	if (process.platform === 'darwin') {
		return macos(name);
	}

	if (process.platform === 'win32') {
		return windows(name);
	}

	return linux(name);
};

},{"os":undefined,"path":undefined}],20:[function(require,module,exports){
'use strict'

var fs = require('fs')

module.exports = clone(fs)

function clone (obj) {
  if (obj === null || typeof obj !== 'object')
    return obj

  if (obj instanceof Object)
    var copy = { __proto__: obj.__proto__ }
  else
    var copy = Object.create(null)

  Object.getOwnPropertyNames(obj).forEach(function (key) {
    Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key))
  })

  return copy
}

},{"fs":undefined}],21:[function(require,module,exports){
var fs = require('fs')
var polyfills = require('./polyfills.js')
var legacy = require('./legacy-streams.js')
var queue = []

var util = require('util')

function noop () {}

var debug = noop
if (util.debuglog)
  debug = util.debuglog('gfs4')
else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ''))
  debug = function() {
    var m = util.format.apply(util, arguments)
    m = 'GFS4: ' + m.split(/\n/).join('\nGFS4: ')
    console.error(m)
  }

if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || '')) {
  process.on('exit', function() {
    debug(queue)
    require('assert').equal(queue.length, 0)
  })
}

module.exports = patch(require('./fs.js'))
if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH) {
  module.exports = patch(fs)
}

// Always patch fs.close/closeSync, because we want to
// retry() whenever a close happens *anywhere* in the program.
// This is essential when multiple graceful-fs instances are
// in play at the same time.
module.exports.close =
fs.close = (function (fs$close) { return function (fd, cb) {
  return fs$close.call(fs, fd, function (err) {
    if (!err)
      retry()

    if (typeof cb === 'function')
      cb.apply(this, arguments)
  })
}})(fs.close)

module.exports.closeSync =
fs.closeSync = (function (fs$closeSync) { return function (fd) {
  // Note that graceful-fs also retries when fs.closeSync() fails.
  // Looks like a bug to me, although it's probably a harmless one.
  var rval = fs$closeSync.apply(fs, arguments)
  retry()
  return rval
}})(fs.closeSync)

function patch (fs) {
  // Everything that references the open() function needs to be in here
  polyfills(fs)
  fs.gracefulify = patch
  fs.FileReadStream = ReadStream;  // Legacy name.
  fs.FileWriteStream = WriteStream;  // Legacy name.
  fs.createReadStream = createReadStream
  fs.createWriteStream = createWriteStream
  var fs$readFile = fs.readFile
  fs.readFile = readFile
  function readFile (path, options, cb) {
    if (typeof options === 'function')
      cb = options, options = null

    return go$readFile(path, options, cb)

    function go$readFile (path, options, cb) {
      return fs$readFile(path, options, function (err) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([go$readFile, [path, options, cb]])
        else {
          if (typeof cb === 'function')
            cb.apply(this, arguments)
          retry()
        }
      })
    }
  }

  var fs$writeFile = fs.writeFile
  fs.writeFile = writeFile
  function writeFile (path, data, options, cb) {
    if (typeof options === 'function')
      cb = options, options = null

    return go$writeFile(path, data, options, cb)

    function go$writeFile (path, data, options, cb) {
      return fs$writeFile(path, data, options, function (err) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([go$writeFile, [path, data, options, cb]])
        else {
          if (typeof cb === 'function')
            cb.apply(this, arguments)
          retry()
        }
      })
    }
  }

  var fs$appendFile = fs.appendFile
  if (fs$appendFile)
    fs.appendFile = appendFile
  function appendFile (path, data, options, cb) {
    if (typeof options === 'function')
      cb = options, options = null

    return go$appendFile(path, data, options, cb)

    function go$appendFile (path, data, options, cb) {
      return fs$appendFile(path, data, options, function (err) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([go$appendFile, [path, data, options, cb]])
        else {
          if (typeof cb === 'function')
            cb.apply(this, arguments)
          retry()
        }
      })
    }
  }

  var fs$readdir = fs.readdir
  fs.readdir = readdir
  function readdir (path, options, cb) {
    var args = [path]
    if (typeof options !== 'function') {
      args.push(options)
    } else {
      cb = options
    }
    args.push(go$readdir$cb)

    return go$readdir(args)

    function go$readdir$cb (err, files) {
      if (files && files.sort)
        files.sort()

      if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
        enqueue([go$readdir, [args]])
      else {
        if (typeof cb === 'function')
          cb.apply(this, arguments)
        retry()
      }
    }
  }

  function go$readdir (args) {
    return fs$readdir.apply(fs, args)
  }

  if (process.version.substr(0, 4) === 'v0.8') {
    var legStreams = legacy(fs)
    ReadStream = legStreams.ReadStream
    WriteStream = legStreams.WriteStream
  }

  var fs$ReadStream = fs.ReadStream
  ReadStream.prototype = Object.create(fs$ReadStream.prototype)
  ReadStream.prototype.open = ReadStream$open

  var fs$WriteStream = fs.WriteStream
  WriteStream.prototype = Object.create(fs$WriteStream.prototype)
  WriteStream.prototype.open = WriteStream$open

  fs.ReadStream = ReadStream
  fs.WriteStream = WriteStream

  function ReadStream (path, options) {
    if (this instanceof ReadStream)
      return fs$ReadStream.apply(this, arguments), this
    else
      return ReadStream.apply(Object.create(ReadStream.prototype), arguments)
  }

  function ReadStream$open () {
    var that = this
    open(that.path, that.flags, that.mode, function (err, fd) {
      if (err) {
        if (that.autoClose)
          that.destroy()

        that.emit('error', err)
      } else {
        that.fd = fd
        that.emit('open', fd)
        that.read()
      }
    })
  }

  function WriteStream (path, options) {
    if (this instanceof WriteStream)
      return fs$WriteStream.apply(this, arguments), this
    else
      return WriteStream.apply(Object.create(WriteStream.prototype), arguments)
  }

  function WriteStream$open () {
    var that = this
    open(that.path, that.flags, that.mode, function (err, fd) {
      if (err) {
        that.destroy()
        that.emit('error', err)
      } else {
        that.fd = fd
        that.emit('open', fd)
      }
    })
  }

  function createReadStream (path, options) {
    return new ReadStream(path, options)
  }

  function createWriteStream (path, options) {
    return new WriteStream(path, options)
  }

  var fs$open = fs.open
  fs.open = open
  function open (path, flags, mode, cb) {
    if (typeof mode === 'function')
      cb = mode, mode = null

    return go$open(path, flags, mode, cb)

    function go$open (path, flags, mode, cb) {
      return fs$open(path, flags, mode, function (err, fd) {
        if (err && (err.code === 'EMFILE' || err.code === 'ENFILE'))
          enqueue([go$open, [path, flags, mode, cb]])
        else {
          if (typeof cb === 'function')
            cb.apply(this, arguments)
          retry()
        }
      })
    }
  }

  return fs
}

function enqueue (elem) {
  debug('ENQUEUE', elem[0].name, elem[1])
  queue.push(elem)
}

function retry () {
  var elem = queue.shift()
  if (elem) {
    debug('RETRY', elem[0].name, elem[1])
    elem[0].apply(null, elem[1])
  }
}

},{"./fs.js":20,"./legacy-streams.js":22,"./polyfills.js":23,"assert":undefined,"fs":undefined,"util":undefined}],22:[function(require,module,exports){
var Stream = require('stream').Stream

module.exports = legacy

function legacy (fs) {
  return {
    ReadStream: ReadStream,
    WriteStream: WriteStream
  }

  function ReadStream (path, options) {
    if (!(this instanceof ReadStream)) return new ReadStream(path, options);

    Stream.call(this);

    var self = this;

    this.path = path;
    this.fd = null;
    this.readable = true;
    this.paused = false;

    this.flags = 'r';
    this.mode = 438; /*=0666*/
    this.bufferSize = 64 * 1024;

    options = options || {};

    // Mixin options into this
    var keys = Object.keys(options);
    for (var index = 0, length = keys.length; index < length; index++) {
      var key = keys[index];
      this[key] = options[key];
    }

    if (this.encoding) this.setEncoding(this.encoding);

    if (this.start !== undefined) {
      if ('number' !== typeof this.start) {
        throw TypeError('start must be a Number');
      }
      if (this.end === undefined) {
        this.end = Infinity;
      } else if ('number' !== typeof this.end) {
        throw TypeError('end must be a Number');
      }

      if (this.start > this.end) {
        throw new Error('start must be <= end');
      }

      this.pos = this.start;
    }

    if (this.fd !== null) {
      process.nextTick(function() {
        self._read();
      });
      return;
    }

    fs.open(this.path, this.flags, this.mode, function (err, fd) {
      if (err) {
        self.emit('error', err);
        self.readable = false;
        return;
      }

      self.fd = fd;
      self.emit('open', fd);
      self._read();
    })
  }

  function WriteStream (path, options) {
    if (!(this instanceof WriteStream)) return new WriteStream(path, options);

    Stream.call(this);

    this.path = path;
    this.fd = null;
    this.writable = true;

    this.flags = 'w';
    this.encoding = 'binary';
    this.mode = 438; /*=0666*/
    this.bytesWritten = 0;

    options = options || {};

    // Mixin options into this
    var keys = Object.keys(options);
    for (var index = 0, length = keys.length; index < length; index++) {
      var key = keys[index];
      this[key] = options[key];
    }

    if (this.start !== undefined) {
      if ('number' !== typeof this.start) {
        throw TypeError('start must be a Number');
      }
      if (this.start < 0) {
        throw new Error('start must be >= zero');
      }

      this.pos = this.start;
    }

    this.busy = false;
    this._queue = [];

    if (this.fd === null) {
      this._open = fs.open;
      this._queue.push([this._open, this.path, this.flags, this.mode, undefined]);
      this.flush();
    }
  }
}

},{"stream":undefined}],23:[function(require,module,exports){
var fs = require('./fs.js')
var constants = require('constants')

var origCwd = process.cwd
var cwd = null

var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform

process.cwd = function() {
  if (!cwd)
    cwd = origCwd.call(process)
  return cwd
}
try {
  process.cwd()
} catch (er) {}

var chdir = process.chdir
process.chdir = function(d) {
  cwd = null
  chdir.call(process, d)
}

module.exports = patch

function patch (fs) {
  // (re-)implement some things that are known busted or missing.

  // lchmod, broken prior to 0.6.2
  // back-port the fix here.
  if (constants.hasOwnProperty('O_SYMLINK') &&
      process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
    patchLchmod(fs)
  }

  // lutimes implementation, or no-op
  if (!fs.lutimes) {
    patchLutimes(fs)
  }

  // https://github.com/isaacs/node-graceful-fs/issues/4
  // Chown should not fail on einval or eperm if non-root.
  // It should not fail on enosys ever, as this just indicates
  // that a fs doesn't support the intended operation.

  fs.chown = chownFix(fs.chown)
  fs.fchown = chownFix(fs.fchown)
  fs.lchown = chownFix(fs.lchown)

  fs.chmod = chmodFix(fs.chmod)
  fs.fchmod = chmodFix(fs.fchmod)
  fs.lchmod = chmodFix(fs.lchmod)

  fs.chownSync = chownFixSync(fs.chownSync)
  fs.fchownSync = chownFixSync(fs.fchownSync)
  fs.lchownSync = chownFixSync(fs.lchownSync)

  fs.chmodSync = chmodFixSync(fs.chmodSync)
  fs.fchmodSync = chmodFixSync(fs.fchmodSync)
  fs.lchmodSync = chmodFixSync(fs.lchmodSync)

  fs.stat = statFix(fs.stat)
  fs.fstat = statFix(fs.fstat)
  fs.lstat = statFix(fs.lstat)

  fs.statSync = statFixSync(fs.statSync)
  fs.fstatSync = statFixSync(fs.fstatSync)
  fs.lstatSync = statFixSync(fs.lstatSync)

  // if lchmod/lchown do not exist, then make them no-ops
  if (!fs.lchmod) {
    fs.lchmod = function (path, mode, cb) {
      if (cb) process.nextTick(cb)
    }
    fs.lchmodSync = function () {}
  }
  if (!fs.lchown) {
    fs.lchown = function (path, uid, gid, cb) {
      if (cb) process.nextTick(cb)
    }
    fs.lchownSync = function () {}
  }

  // on Windows, A/V software can lock the directory, causing this
  // to fail with an EACCES or EPERM if the directory contains newly
  // created files.  Try again on failure, for up to 60 seconds.

  // Set the timeout this long because some Windows Anti-Virus, such as Parity
  // bit9, may lock files for up to a minute, causing npm package install
  // failures. Also, take care to yield the scheduler. Windows scheduling gives
  // CPU to a busy looping process, which can cause the program causing the lock
  // contention to be starved of CPU by node, so the contention doesn't resolve.
  if (platform === "win32") {
    fs.rename = (function (fs$rename) { return function (from, to, cb) {
      var start = Date.now()
      var backoff = 0;
      fs$rename(from, to, function CB (er) {
        if (er
            && (er.code === "EACCES" || er.code === "EPERM")
            && Date.now() - start < 60000) {
          setTimeout(function() {
            fs.stat(to, function (stater, st) {
              if (stater && stater.code === "ENOENT")
                fs$rename(from, to, CB);
              else
                cb(er)
            })
          }, backoff)
          if (backoff < 100)
            backoff += 10;
          return;
        }
        if (cb) cb(er)
      })
    }})(fs.rename)
  }

  // if read() returns EAGAIN, then just try it again.
  fs.read = (function (fs$read) { return function (fd, buffer, offset, length, position, callback_) {
    var callback
    if (callback_ && typeof callback_ === 'function') {
      var eagCounter = 0
      callback = function (er, _, __) {
        if (er && er.code === 'EAGAIN' && eagCounter < 10) {
          eagCounter ++
          return fs$read.call(fs, fd, buffer, offset, length, position, callback)
        }
        callback_.apply(this, arguments)
      }
    }
    return fs$read.call(fs, fd, buffer, offset, length, position, callback)
  }})(fs.read)

  fs.readSync = (function (fs$readSync) { return function (fd, buffer, offset, length, position) {
    var eagCounter = 0
    while (true) {
      try {
        return fs$readSync.call(fs, fd, buffer, offset, length, position)
      } catch (er) {
        if (er.code === 'EAGAIN' && eagCounter < 10) {
          eagCounter ++
          continue
        }
        throw er
      }
    }
  }})(fs.readSync)
}

function patchLchmod (fs) {
  fs.lchmod = function (path, mode, callback) {
    fs.open( path
           , constants.O_WRONLY | constants.O_SYMLINK
           , mode
           , function (err, fd) {
      if (err) {
        if (callback) callback(err)
        return
      }
      // prefer to return the chmod error, if one occurs,
      // but still try to close, and report closing errors if they occur.
      fs.fchmod(fd, mode, function (err) {
        fs.close(fd, function(err2) {
          if (callback) callback(err || err2)
        })
      })
    })
  }

  fs.lchmodSync = function (path, mode) {
    var fd = fs.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode)

    // prefer to return the chmod error, if one occurs,
    // but still try to close, and report closing errors if they occur.
    var threw = true
    var ret
    try {
      ret = fs.fchmodSync(fd, mode)
      threw = false
    } finally {
      if (threw) {
        try {
          fs.closeSync(fd)
        } catch (er) {}
      } else {
        fs.closeSync(fd)
      }
    }
    return ret
  }
}

function patchLutimes (fs) {
  if (constants.hasOwnProperty("O_SYMLINK")) {
    fs.lutimes = function (path, at, mt, cb) {
      fs.open(path, constants.O_SYMLINK, function (er, fd) {
        if (er) {
          if (cb) cb(er)
          return
        }
        fs.futimes(fd, at, mt, function (er) {
          fs.close(fd, function (er2) {
            if (cb) cb(er || er2)
          })
        })
      })
    }

    fs.lutimesSync = function (path, at, mt) {
      var fd = fs.openSync(path, constants.O_SYMLINK)
      var ret
      var threw = true
      try {
        ret = fs.futimesSync(fd, at, mt)
        threw = false
      } finally {
        if (threw) {
          try {
            fs.closeSync(fd)
          } catch (er) {}
        } else {
          fs.closeSync(fd)
        }
      }
      return ret
    }

  } else {
    fs.lutimes = function (_a, _b, _c, cb) { if (cb) process.nextTick(cb) }
    fs.lutimesSync = function () {}
  }
}

function chmodFix (orig) {
  if (!orig) return orig
  return function (target, mode, cb) {
    return orig.call(fs, target, mode, function (er) {
      if (chownErOk(er)) er = null
      if (cb) cb.apply(this, arguments)
    })
  }
}

function chmodFixSync (orig) {
  if (!orig) return orig
  return function (target, mode) {
    try {
      return orig.call(fs, target, mode)
    } catch (er) {
      if (!chownErOk(er)) throw er
    }
  }
}


function chownFix (orig) {
  if (!orig) return orig
  return function (target, uid, gid, cb) {
    return orig.call(fs, target, uid, gid, function (er) {
      if (chownErOk(er)) er = null
      if (cb) cb.apply(this, arguments)
    })
  }
}

function chownFixSync (orig) {
  if (!orig) return orig
  return function (target, uid, gid) {
    try {
      return orig.call(fs, target, uid, gid)
    } catch (er) {
      if (!chownErOk(er)) throw er
    }
  }
}


function statFix (orig) {
  if (!orig) return orig
  // Older versions of Node erroneously returned signed integers for
  // uid + gid.
  return function (target, cb) {
    return orig.call(fs, target, function (er, stats) {
      if (!stats) return cb.apply(this, arguments)
      if (stats.uid < 0) stats.uid += 0x100000000
      if (stats.gid < 0) stats.gid += 0x100000000
      if (cb) cb.apply(this, arguments)
    })
  }
}

function statFixSync (orig) {
  if (!orig) return orig
  // Older versions of Node erroneously returned signed integers for
  // uid + gid.
  return function (target) {
    var stats = orig.call(fs, target)
    if (stats.uid < 0) stats.uid += 0x100000000
    if (stats.gid < 0) stats.gid += 0x100000000
    return stats;
  }
}

// ENOSYS means that the fs doesn't support the op. Just ignore
// that, because it doesn't matter.
//
// if there's no getuid, or if getuid() is something other
// than 0, and the error is EINVAL or EPERM, then just ignore
// it.
//
// This specific case is a silent failure in cp, install, tar,
// and most other unix tools that manage permissions.
//
// When running as root, or if other types of errors are
// encountered, then it's strict.
function chownErOk (er) {
  if (!er)
    return true

  if (er.code === "ENOSYS")
    return true

  var nonroot = !process.getuid || process.getuid() !== 0
  if (nonroot) {
    if (er.code === "EINVAL" || er.code === "EPERM")
      return true
  }

  return false
}

},{"./fs.js":20,"constants":undefined}],24:[function(require,module,exports){
/**
 * @preserve
 * JS Implementation of incremental MurmurHash3 (r150) (as of May 10, 2013)
 *
 * @author <a href="mailto:jensyt@gmail.com">Jens Taylor</a>
 * @see http://github.com/homebrewing/brauhaus-diff
 * @author <a href="mailto:gary.court@gmail.com">Gary Court</a>
 * @see http://github.com/garycourt/murmurhash-js
 * @author <a href="mailto:aappleby@gmail.com">Austin Appleby</a>
 * @see http://sites.google.com/site/murmurhash/
 */
(function(){
    var cache;

    // Call this function without `new` to use the cached object (good for
    // single-threaded environments), or with `new` to create a new object.
    //
    // @param {string} key A UTF-16 or ASCII string
    // @param {number} seed An optional positive integer
    // @return {object} A MurmurHash3 object for incremental hashing
    function MurmurHash3(key, seed) {
        var m = this instanceof MurmurHash3 ? this : cache;
        m.reset(seed)
        if (typeof key === 'string' && key.length > 0) {
            m.hash(key);
        }

        if (m !== this) {
            return m;
        }
    };

    // Incrementally add a string to this hash
    //
    // @param {string} key A UTF-16 or ASCII string
    // @return {object} this
    MurmurHash3.prototype.hash = function(key) {
        var h1, k1, i, top, len;

        len = key.length;
        this.len += len;

        k1 = this.k1;
        i = 0;
        switch (this.rem) {
            case 0: k1 ^= len > i ? (key.charCodeAt(i++) & 0xffff) : 0;
            case 1: k1 ^= len > i ? (key.charCodeAt(i++) & 0xffff) << 8 : 0;
            case 2: k1 ^= len > i ? (key.charCodeAt(i++) & 0xffff) << 16 : 0;
            case 3:
                k1 ^= len > i ? (key.charCodeAt(i) & 0xff) << 24 : 0;
                k1 ^= len > i ? (key.charCodeAt(i++) & 0xff00) >> 8 : 0;
        }

        this.rem = (len + this.rem) & 3; // & 3 is same as % 4
        len -= this.rem;
        if (len > 0) {
            h1 = this.h1;
            while (1) {
                k1 = (k1 * 0x2d51 + (k1 & 0xffff) * 0xcc9e0000) & 0xffffffff;
                k1 = (k1 << 15) | (k1 >>> 17);
                k1 = (k1 * 0x3593 + (k1 & 0xffff) * 0x1b870000) & 0xffffffff;

                h1 ^= k1;
                h1 = (h1 << 13) | (h1 >>> 19);
                h1 = (h1 * 5 + 0xe6546b64) & 0xffffffff;

                if (i >= len) {
                    break;
                }

                k1 = ((key.charCodeAt(i++) & 0xffff)) ^
                     ((key.charCodeAt(i++) & 0xffff) << 8) ^
                     ((key.charCodeAt(i++) & 0xffff) << 16);
                top = key.charCodeAt(i++);
                k1 ^= ((top & 0xff) << 24) ^
                      ((top & 0xff00) >> 8);
            }

            k1 = 0;
            switch (this.rem) {
                case 3: k1 ^= (key.charCodeAt(i + 2) & 0xffff) << 16;
                case 2: k1 ^= (key.charCodeAt(i + 1) & 0xffff) << 8;
                case 1: k1 ^= (key.charCodeAt(i) & 0xffff);
            }

            this.h1 = h1;
        }

        this.k1 = k1;
        return this;
    };

    // Get the result of this hash
    //
    // @return {number} The 32-bit hash
    MurmurHash3.prototype.result = function() {
        var k1, h1;
        
        k1 = this.k1;
        h1 = this.h1;

        if (k1 > 0) {
            k1 = (k1 * 0x2d51 + (k1 & 0xffff) * 0xcc9e0000) & 0xffffffff;
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = (k1 * 0x3593 + (k1 & 0xffff) * 0x1b870000) & 0xffffffff;
            h1 ^= k1;
        }

        h1 ^= this.len;

        h1 ^= h1 >>> 16;
        h1 = (h1 * 0xca6b + (h1 & 0xffff) * 0x85eb0000) & 0xffffffff;
        h1 ^= h1 >>> 13;
        h1 = (h1 * 0xae35 + (h1 & 0xffff) * 0xc2b20000) & 0xffffffff;
        h1 ^= h1 >>> 16;

        return h1 >>> 0;
    };

    // Reset the hash object for reuse
    //
    // @param {number} seed An optional positive integer
    MurmurHash3.prototype.reset = function(seed) {
        this.h1 = typeof seed === 'number' ? seed : 0;
        this.rem = this.k1 = this.len = 0;
        return this;
    };

    // A cached object to use. This can be safely used if you're in a single-
    // threaded environment, otherwise you need to create new hashes to use.
    cache = new MurmurHash3();

    if (typeof(module) != 'undefined') {
        module.exports = MurmurHash3;
    } else {
        this.MurmurHash3 = MurmurHash3;
    }
}());

},{}],25:[function(require,module,exports){
'use strict';
module.exports = function (x) {
	var type = typeof x;
	return x !== null && (type === 'object' || type === 'function');
};

},{}],26:[function(require,module,exports){
'use strict';
const path = require('path');
const pathExists = require('path-exists');
const pLocate = require('p-locate');

module.exports = (iterable, opts) => {
	opts = Object.assign({
		cwd: process.cwd()
	}, opts);

	return pLocate(iterable, el => pathExists(path.resolve(opts.cwd, el)), opts);
};

module.exports.sync = (iterable, opts) => {
	opts = Object.assign({
		cwd: process.cwd()
	}, opts);

	for (const el of iterable) {
		if (pathExists.sync(path.resolve(opts.cwd, el))) {
			return el;
		}
	}
};

},{"p-locate":30,"path":undefined,"path-exists":32}],27:[function(require,module,exports){
'use strict';
const fs = require('fs');
const path = require('path');
const pify = require('pify');

const defaults = {
	mode: 0o777 & (~process.umask()),
	fs
};

// https://github.com/nodejs/node/issues/8987
// https://github.com/libuv/libuv/pull/1088
const checkPath = pth => {
	if (process.platform === 'win32') {
		const pathHasInvalidWinCharacters = /[<>:"|?*]/.test(pth.replace(path.parse(pth).root, ''));

		if (pathHasInvalidWinCharacters) {
			const err = new Error(`Path contains invalid characters: ${pth}`);
			err.code = 'EINVAL';
			throw err;
		}
	}
};

module.exports = (input, opts) => Promise.resolve().then(() => {
	checkPath(input);
	opts = Object.assign({}, defaults, opts);

	const mkdir = pify(opts.fs.mkdir);
	const stat = pify(opts.fs.stat);

	const make = pth => {
		return mkdir(pth, opts.mode)
			.then(() => pth)
			.catch(err => {
				if (err.code === 'ENOENT') {
					if (err.message.includes('null bytes') || path.dirname(pth) === pth) {
						throw err;
					}

					return make(path.dirname(pth)).then(() => make(pth));
				}

				return stat(pth)
					.then(stats => stats.isDirectory() ? pth : Promise.reject())
					.catch(() => {
						throw err;
					});
			});
	};

	return make(path.resolve(input));
});

module.exports.sync = (input, opts) => {
	checkPath(input);
	opts = Object.assign({}, defaults, opts);

	const make = pth => {
		try {
			opts.fs.mkdirSync(pth, opts.mode);
		} catch (err) {
			if (err.code === 'ENOENT') {
				if (err.message.includes('null bytes') || path.dirname(pth) === pth) {
					throw err;
				}

				make(path.dirname(pth));
				return make(pth);
			}

			try {
				if (!opts.fs.statSync(pth).isDirectory()) {
					throw new Error('The path is not a directory');
				}
			} catch (_) {
				throw err;
			}
		}

		return pth;
	};

	return make(path.resolve(input));
};

},{"fs":undefined,"path":undefined,"pify":28}],28:[function(require,module,exports){
'use strict';

const processFn = (fn, opts) => function () {
	const P = opts.promiseModule;
	const args = new Array(arguments.length);

	for (let i = 0; i < arguments.length; i++) {
		args[i] = arguments[i];
	}

	return new P((resolve, reject) => {
		if (opts.errorFirst) {
			args.push(function (err, result) {
				if (opts.multiArgs) {
					const results = new Array(arguments.length - 1);

					for (let i = 1; i < arguments.length; i++) {
						results[i - 1] = arguments[i];
					}

					if (err) {
						results.unshift(err);
						reject(results);
					} else {
						resolve(results);
					}
				} else if (err) {
					reject(err);
				} else {
					resolve(result);
				}
			});
		} else {
			args.push(function (result) {
				if (opts.multiArgs) {
					const results = new Array(arguments.length - 1);

					for (let i = 0; i < arguments.length; i++) {
						results[i] = arguments[i];
					}

					resolve(results);
				} else {
					resolve(result);
				}
			});
		}

		fn.apply(this, args);
	});
};

module.exports = (obj, opts) => {
	opts = Object.assign({
		exclude: [/.+(Sync|Stream)$/],
		errorFirst: true,
		promiseModule: Promise
	}, opts);

	const filter = key => {
		const match = pattern => typeof pattern === 'string' ? key === pattern : pattern.test(key);
		return opts.include ? opts.include.some(match) : !opts.exclude.some(match);
	};

	let ret;
	if (typeof obj === 'function') {
		ret = function () {
			if (opts.excludeMain) {
				return obj.apply(this, arguments);
			}

			return processFn(obj, opts).apply(this, arguments);
		};
	} else {
		ret = Object.create(Object.getPrototypeOf(obj));
	}

	for (const key in obj) { // eslint-disable-line guard-for-in
		const x = obj[key];
		ret[key] = typeof x === 'function' && filter(key) ? processFn(x, opts) : x;
	}

	return ret;
};

},{}],29:[function(require,module,exports){
'use strict';
const pTry = require('p-try');

module.exports = concurrency => {
	if (concurrency < 1) {
		throw new TypeError('Expected `concurrency` to be a number from 1 and up');
	}

	const queue = [];
	let activeCount = 0;

	const next = () => {
		activeCount--;

		if (queue.length > 0) {
			queue.shift()();
		}
	};

	return fn => new Promise((resolve, reject) => {
		const run = () => {
			activeCount++;

			pTry(fn).then(
				val => {
					resolve(val);
					next();
				},
				err => {
					reject(err);
					next();
				}
			);
		};

		if (activeCount < concurrency) {
			run();
		} else {
			queue.push(run);
		}
	});
};

},{"p-try":31}],30:[function(require,module,exports){
'use strict';
const pLimit = require('p-limit');

class EndError extends Error {
	constructor(value) {
		super();
		this.value = value;
	}
}

// the input can also be a promise, so we `Promise.all()` them both
const finder = el => Promise.all(el).then(val => val[1] === true && Promise.reject(new EndError(val[0])));

module.exports = (iterable, tester, opts) => {
	opts = Object.assign({
		concurrency: Infinity,
		preserveOrder: true
	}, opts);

	const limit = pLimit(opts.concurrency);

	// start all the promises concurrently with optional limit
	const items = Array.from(iterable).map(el => [el, limit(() => Promise.resolve(el).then(tester))]);

	// check the promises either serially or concurrently
	const checkLimit = pLimit(opts.preserveOrder ? 1 : Infinity);

	return Promise.all(items.map(el => checkLimit(() => finder(el))))
		.then(() => {})
		.catch(err => err instanceof EndError ? err.value : Promise.reject(err));
};

},{"p-limit":29}],31:[function(require,module,exports){
'use strict';
module.exports = cb => new Promise(resolve => {
	resolve(cb());
});

},{}],32:[function(require,module,exports){
'use strict';
const fs = require('fs');

module.exports = fp => new Promise(resolve => {
	fs.access(fp, err => {
		resolve(!err);
	});
});

module.exports.sync = fp => {
	try {
		fs.accessSync(fp);
		return true;
	} catch (err) {
		return false;
	}
};

},{"fs":undefined}],33:[function(require,module,exports){
'use strict';
const findUp = require('find-up');

module.exports = cwd => findUp('package.json', {cwd});
module.exports.sync = cwd => findUp.sync('package.json', {cwd});

},{"find-up":34}],34:[function(require,module,exports){
'use strict';
const path = require('path');
const locatePath = require('locate-path');

module.exports = (filename, opts) => {
	opts = opts || {};

	const startDir = path.resolve(opts.cwd || '');
	const root = path.parse(startDir).root;

	const filenames = [].concat(filename);

	return new Promise(resolve => {
		(function find(dir) {
			locatePath(filenames, {cwd: dir}).then(file => {
				if (file) {
					resolve(path.join(dir, file));
				} else if (dir === root) {
					resolve(null);
				} else {
					find(path.dirname(dir));
				}
			});
		})(startDir);
	});
};

module.exports.sync = (filename, opts) => {
	opts = opts || {};

	let dir = path.resolve(opts.cwd || '');
	const root = path.parse(dir).root;

	const filenames = [].concat(filename);

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const file = locatePath.sync(filenames, {cwd: dir});

		if (file) {
			return path.join(dir, file);
		} else if (dir === root) {
			return null;
		}

		dir = path.dirname(dir);
	}
};

},{"locate-path":26,"path":undefined}],35:[function(require,module,exports){
// Note: since nyc uses this module to output coverage, any lines
// that are in the direct sync flow of nyc's outputCoverage are
// ignored, since we can never get coverage for them.
var assert = require('assert')
var signals = require('./signals.js')

var EE = require('events')
/* istanbul ignore if */
if (typeof EE !== 'function') {
  EE = EE.EventEmitter
}

var emitter
if (process.__signal_exit_emitter__) {
  emitter = process.__signal_exit_emitter__
} else {
  emitter = process.__signal_exit_emitter__ = new EE()
  emitter.count = 0
  emitter.emitted = {}
}

// Because this emitter is a global, we have to check to see if a
// previous version of this library failed to enable infinite listeners.
// I know what you're about to say.  But literally everything about
// signal-exit is a compromise with evil.  Get used to it.
if (!emitter.infinite) {
  emitter.setMaxListeners(Infinity)
  emitter.infinite = true
}

module.exports = function (cb, opts) {
  assert.equal(typeof cb, 'function', 'a callback must be provided for exit handler')

  if (loaded === false) {
    load()
  }

  var ev = 'exit'
  if (opts && opts.alwaysLast) {
    ev = 'afterexit'
  }

  var remove = function () {
    emitter.removeListener(ev, cb)
    if (emitter.listeners('exit').length === 0 &&
        emitter.listeners('afterexit').length === 0) {
      unload()
    }
  }
  emitter.on(ev, cb)

  return remove
}

module.exports.unload = unload
function unload () {
  if (!loaded) {
    return
  }
  loaded = false

  signals.forEach(function (sig) {
    try {
      process.removeListener(sig, sigListeners[sig])
    } catch (er) {}
  })
  process.emit = originalProcessEmit
  process.reallyExit = originalProcessReallyExit
  emitter.count -= 1
}

function emit (event, code, signal) {
  if (emitter.emitted[event]) {
    return
  }
  emitter.emitted[event] = true
  emitter.emit(event, code, signal)
}

// { <signal>: <listener fn>, ... }
var sigListeners = {}
signals.forEach(function (sig) {
  sigListeners[sig] = function listener () {
    // If there are no other listeners, an exit is coming!
    // Simplest way: remove us and then re-send the signal.
    // We know that this will kill the process, so we can
    // safely emit now.
    var listeners = process.listeners(sig)
    if (listeners.length === emitter.count) {
      unload()
      emit('exit', null, sig)
      /* istanbul ignore next */
      emit('afterexit', null, sig)
      /* istanbul ignore next */
      process.kill(process.pid, sig)
    }
  }
})

module.exports.signals = function () {
  return signals
}

module.exports.load = load

var loaded = false

function load () {
  if (loaded) {
    return
  }
  loaded = true

  // This is the number of onSignalExit's that are in play.
  // It's important so that we can count the correct number of
  // listeners on signals, and don't wait for the other one to
  // handle it instead of us.
  emitter.count += 1

  signals = signals.filter(function (sig) {
    try {
      process.on(sig, sigListeners[sig])
      return true
    } catch (er) {
      return false
    }
  })

  process.emit = processEmit
  process.reallyExit = processReallyExit
}

var originalProcessReallyExit = process.reallyExit
function processReallyExit (code) {
  process.exitCode = code || 0
  emit('exit', process.exitCode, null)
  /* istanbul ignore next */
  emit('afterexit', process.exitCode, null)
  /* istanbul ignore next */
  originalProcessReallyExit.call(process, process.exitCode)
}

var originalProcessEmit = process.emit
function processEmit (ev, arg) {
  if (ev === 'exit') {
    if (arg !== undefined) {
      process.exitCode = arg
    }
    var ret = originalProcessEmit.apply(this, arguments)
    emit('exit', process.exitCode, null)
    /* istanbul ignore next */
    emit('afterexit', process.exitCode, null)
    return ret
  } else {
    return originalProcessEmit.apply(this, arguments)
  }
}

},{"./signals.js":36,"assert":undefined,"events":undefined}],36:[function(require,module,exports){
// This is not the set of all possible signals.
//
// It IS, however, the set of all signals that trigger
// an exit on either Linux or BSD systems.  Linux is a
// superset of the signal names supported on BSD, and
// the unknown signals just fail to register, so we can
// catch that easily enough.
//
// Don't bother with SIGKILL.  It's uncatchable, which
// means that we can't fire any callbacks anyway.
//
// If a user does happen to register a handler on a non-
// fatal signal like SIGWINCH or something, and then
// exit, it'll end up firing `process.emit('exit')`, so
// the handler will be fired anyway.
//
// SIGBUS, SIGFPE, SIGSEGV and SIGILL, when not raised
// artificially, inherently leave the process in a
// state from which it is not safe to try and enter JS
// listeners.
module.exports = [
  'SIGABRT',
  'SIGALRM',
  'SIGHUP',
  'SIGINT',
  'SIGTERM'
]

if (process.platform !== 'win32') {
  module.exports.push(
    'SIGVTALRM',
    'SIGXCPU',
    'SIGXFSZ',
    'SIGUSR2',
    'SIGTRAP',
    'SIGSYS',
    'SIGQUIT',
    'SIGIOT'
    // should detect profiler and enable/disable accordingly.
    // see #21
    // 'SIGPROF'
  )
}

if (process.platform === 'linux') {
  module.exports.push(
    'SIGIO',
    'SIGPOLL',
    'SIGPWR',
    'SIGSTKFLT',
    'SIGUNUSED'
  )
}

},{}],37:[function(require,module,exports){
(function (global){
'use strict'
module.exports = writeFile
module.exports.sync = writeFileSync
module.exports._getTmpname = getTmpname // for testing
module.exports._cleanupOnExit = cleanupOnExit

var fs = require('graceful-fs')
var MurmurHash3 = require('imurmurhash')
var onExit = require('signal-exit')
var path = require('path')
var activeFiles = {}

var invocations = 0
function getTmpname (filename) {
  return filename + '.' +
    MurmurHash3(__filename)
      .hash(String(process.pid))
      .hash(String(++invocations))
      .result()
}

function cleanupOnExit (tmpfile) {
  return function () {
    try {
      fs.unlinkSync(typeof tmpfile === 'function' ? tmpfile() : tmpfile)
    } catch (_) {}
  }
}

function writeFile (filename, data, options, callback) {
  if (options instanceof Function) {
    callback = options
    options = null
  }
  if (!options) options = {}

  var Promise = options.Promise || global.Promise
  var truename
  var fd
  var tmpfile
  var removeOnExit = cleanupOnExit(() => tmpfile)
  var absoluteName = path.resolve(filename)

  new Promise(function serializeSameFile (resolve) {
    // make a queue if it doesn't already exist
    if (!activeFiles[absoluteName]) activeFiles[absoluteName] = []

    activeFiles[absoluteName].push(resolve) // add this job to the queue
    if (activeFiles[absoluteName].length === 1) resolve() // kick off the first one
  }).then(function getRealPath () {
    return new Promise(function (resolve) {
      fs.realpath(filename, function (_, realname) {
        truename = realname || filename
        tmpfile = getTmpname(truename)
        resolve()
      })
    })
  }).then(function stat () {
    return new Promise(function stat (resolve) {
      if (options.mode && options.chown) resolve()
      else {
        // Either mode or chown is not explicitly set
        // Default behavior is to copy it from original file
        fs.stat(truename, function (err, stats) {
          if (err || !stats) resolve()
          else {
            options = Object.assign({}, options)

            if (!options.mode) {
              options.mode = stats.mode
            }
            if (!options.chown && process.getuid) {
              options.chown = { uid: stats.uid, gid: stats.gid }
            }
            resolve()
          }
        })
      }
    })
  }).then(function thenWriteFile () {
    return new Promise(function (resolve, reject) {
      fs.open(tmpfile, 'w', options.mode, function (err, _fd) {
        fd = _fd
        if (err) reject(err)
        else resolve()
      })
    })
  }).then(function write () {
    return new Promise(function (resolve, reject) {
      if (Buffer.isBuffer(data)) {
        fs.write(fd, data, 0, data.length, 0, function (err) {
          if (err) reject(err)
          else resolve()
        })
      } else if (data != null) {
        fs.write(fd, String(data), 0, String(options.encoding || 'utf8'), function (err) {
          if (err) reject(err)
          else resolve()
        })
      } else resolve()
    })
  }).then(function syncAndClose () {
    if (options.fsync !== false) {
      return new Promise(function (resolve, reject) {
        fs.fsync(fd, function (err) {
          if (err) reject(err)
          else fs.close(fd, resolve)
        })
      })
    }
  }).then(function chown () {
    if (options.chown) {
      return new Promise(function (resolve, reject) {
        fs.chown(tmpfile, options.chown.uid, options.chown.gid, function (err) {
          if (err) reject(err)
          else resolve()
        })
      })
    }
  }).then(function chmod () {
    if (options.mode) {
      return new Promise(function (resolve, reject) {
        fs.chmod(tmpfile, options.mode, function (err) {
          if (err) reject(err)
          else resolve()
        })
      })
    }
  }).then(function rename () {
    return new Promise(function (resolve, reject) {
      fs.rename(tmpfile, truename, function (err) {
        if (err) reject(err)
        else resolve()
      })
    })
  }).then(function success () {
    removeOnExit()
    callback()
  }).catch(function fail (err) {
    removeOnExit()
    fs.unlink(tmpfile, function () {
      callback(err)
    })
  }).then(function checkQueue () {
    activeFiles[absoluteName].shift() // remove the element added by serializeSameFile
    if (activeFiles[absoluteName].length > 0) {
      activeFiles[absoluteName][0]() // start next job if one is pending
    } else delete activeFiles[absoluteName]
  })
}

function writeFileSync (filename, data, options) {
  if (!options) options = {}
  try {
    filename = fs.realpathSync(filename)
  } catch (ex) {
    // it's ok, it'll happen on a not yet existing file
  }
  var tmpfile = getTmpname(filename)

  try {
    if (!options.mode || !options.chown) {
      // Either mode or chown is not explicitly set
      // Default behavior is to copy it from original file
      try {
        var stats = fs.statSync(filename)
        options = Object.assign({}, options)
        if (!options.mode) {
          options.mode = stats.mode
        }
        if (!options.chown && process.getuid) {
          options.chown = { uid: stats.uid, gid: stats.gid }
        }
      } catch (ex) {
        // ignore stat errors
      }
    }

    var removeOnExit = onExit(cleanupOnExit(tmpfile))
    var fd = fs.openSync(tmpfile, 'w', options.mode)
    if (Buffer.isBuffer(data)) {
      fs.writeSync(fd, data, 0, data.length, 0)
    } else if (data != null) {
      fs.writeSync(fd, String(data), 0, String(options.encoding || 'utf8'))
    }
    if (options.fsync !== false) {
      fs.fsyncSync(fd)
    }
    fs.closeSync(fd)
    if (options.chown) fs.chownSync(tmpfile, options.chown.uid, options.chown.gid)
    if (options.mode) fs.chmodSync(tmpfile, options.mode)
    fs.renameSync(tmpfile, filename)
    removeOnExit()
  } catch (err) {
    removeOnExit()
    try { fs.unlinkSync(tmpfile) } catch (e) {}
    throw err
  }
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"graceful-fs":21,"imurmurhash":24,"path":undefined,"signal-exit":35}],38:[function(require,module,exports){
var config = {};

// self explanatory, your application name, descriptions, etc
config.appName = 'WalletShell';
config.appDescription = 'TurtleCoin Wallet';
config.appSlogan = 'Slow and steady wins the race!';
config.appId = 'lol.turtlecoin.walletshell';
config.appGitRepo = 'https://github.com/turtlecoin/turtle-wallet-electron';

// default port number for your daemon (e.g. TurtleCoind)
config.daemonDefaultRpcPort = 11898;

// wallet file created by this app will have this extension
config.walletFileDefaultExt = 'twl';

// change this to match your wallet service executable filename
config.walletServiceBinaryFilename = 'turtle-service';

// version on the bundled service (turtle-service)
config.walletServiceBinaryVersion = "v0.13.0";

// config file format supported by wallet service, possible values:
// ini -->  for turtle service (or its forks) version <= v0.8.3
// json --> for turtle service (or its forks) version >= v0.8.4
config.walletServiceConfigFormat = "json";

// default port number for your wallet service (e.g. turtle-service)
config.walletServiceRpcPort = 8070;

// block explorer url, the [[TX_HASH]] will be substituted w/ actual transaction hash
config.blockExplorerUrl = 'https://explorer.turtlecoin.lol/transaction.html?hash=[[TX_HASH]]';

// default remote node to connect to, set this to a known reliable node for 'just works' user experience
config.remoteNodeDefaultHost = 'turtlenode.co';


// remote node list update url, set to null if you don't have one
// for TRTL:
// raw list: https://raw.githubusercontent.com/turtlecoin/turtlecoin-nodes-json/master/turtlecoin-nodes.json
// filtered: https://trtl.nodes.pub/api/getNodes
config.remoteNodeListUpdateUrl = 'https://trtl.nodes.pub/api/getNodes';

// set to false if using raw/unfiltered node list
config.remoteNodeListFiltered = true;

// fallback remote node list, in case fetching update failed, fill this with known to works remote nodes
config.remoteNodeListFallback = [
  'turtlenode.co:11898',
  'nodes.hashvault.pro:11898',
  'turtle.mine.nu:11898',
];
config.remoteNodeCacheSupported = false;
config.remoteNodeSslSupported = false;

// your currency name
config.assetName = 'TurtleCoin';
// your currency ticker
config.assetTicker = 'TRTL';
// your currency address prefix, for address validation
config.addressPrefix = 'TRTL';
// standard wallet address length, for address validation
config.addressLength = 99;
// integrated wallet address length, for address validation. Added length is length of payment ID encoded in base58.
config.integratedAddressLength = config.addressLength + ((64 * 11) / 8);

// minimum fee for sending transaction
config.minimumFee = 0.1;
// minimum amount for sending transaction
config.mininumSend = 0.1;
// default mixin/anonimity for transaction
config.defaultMixin = 3;
// to represent human readable value
config.decimalPlaces = 2;
// to convert from atomic unit
config.decimalDivisor = 10 ** config.decimalPlaces;

// obfuscate address book entries, set to false if you want to save it in plain json file.
// not for security because the encryption key is attached here
config.addressBookObfuscateEntries = true;
// key use to obfuscate address book contents
config.addressBookObfuscationKey = '79009fb00ca1b7130832a42de45142cf6c4b7f333fe6fba5';
// initial/sample entries to fill new address book
config.addressBookSampleEntries = [
  {
    name: 'WalletShell Donation',
    address: 'TRTLv1A26ngXApin33p1JsSE9Yf6REj97Xruz15D4JtSg1wuqYTmsPj5Geu2kHtBzD8TCsfd5dbdYRsrhNXMGyvtJ61AoYqLXVS',
    paymentId: '',
  }
];
// cipher config for private address book
config.addressBookCipherConfig = {
  algorithm: 'aes-256-gcm',
  saltLenght: 128,
  pbkdf2Rounds: 10000,
  pbkdf2Digest: 'sha512'
};

module.exports = config;

},{}]},{},[1]);
