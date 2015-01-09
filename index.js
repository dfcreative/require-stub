﻿/**
* Require stub for browser.
* Prepend this script in head.
* Set `data-module="name"` attribute on script tag to define module name to register (or it will be parsed as src file name).
*/


//TODO: load remote requirements (github ones, like dfcreative/color)
//TODO: add splashscreen or some notification of initial loading
//TODO: ensure that there’re no extra-modules loaded (fully browserifyable, no fake-paths parsing)
//TODO: make it work in web-workers


(function(global){
if (global.require) {
	throw Error('Turn off `require-stub`: another `require` is on.');
	return;
}


/** Cache of once found filepaths. Use them first to resolve modules. */
var modulePathsCacheKey = 'rs-paths';
var modulePathsCache = sessionStorage.getItem(modulePathsCacheKey);
if (modulePathsCache) modulePathsCache = JSON.parse(modulePathsCache);
else modulePathsCache = {};


/** try to look up for script (causes 404 requests) */
require.lookUpModules = true;

/** try to guess file path, if no package.json found (causes intense 404 traffic)*/
require.guessPath = true;

/** try to fetch requirement from github, if not found */
require.fetchFromGithub = false;

/** load dev deps (may cause a shitload of XHTTP traffic) */
require.loadDevDeps = false;


/** modules storage, moduleName: moduleExports  */
var modules = require.modules = {};

/** paths-names dict, modulePath: moduleName */
var modulePaths = require.modulePaths = {};

/** packages storage: `moduleName:package`, `path:package` */
var packages = {};

/** stack of errors to log */
var errors = [];


//script run emulation
var fakeCurrentScript, fakeStack = [];


//try to load initial module package
try {
	console.groupCollapsed('package.json');

	// http://localhost:8000/
	var rootPath = getAbsolutePath('/');
	// http://localhost:8000/test/
	var currPath = getAbsolutePath('');

	//reach root (initial) package.json (closest one to the current url)
	var selfPkg = requestClosestPkg(getAbsolutePath(''), true);

	//load browser builtins
	var currDir = getDir(getAbsolutePath(getCurrentScript().src));
	requestPkg(currDir);


	//clear cache, if current package has changed
	var savedModuleName = sessionStorage.getItem('rs-saved-name');
	if (savedModuleName && selfPkg.name !== savedModuleName || savedModuleName === null) {
		sessionStorage.clear();
		sessionStorage.setItem('rs-saved-name', selfPkg.name);
	}

	if (!selfPkg) console.warn('Can’t find main package.json by `' + rootPath + '` nor by `' +  getAbsolutePath('') + '`.');
} catch (e){
	throw e;
}
finally{
	console.groupEnd();
}



/** export function */
global.require = require;


/** require stub */
function require(name) {
	var location = getCurrentScript().src || global.location + '';

	if (!name) throw Error('Bad module name `' + name + '`', location);

	console.groupCollapsed('require(\'' + name + '\') ', location);


	//if package redirect - use redirect name
	if (typeof packages[name] === 'string') {
		name = packages[name];
	}


	//try to fetch existing module
	var result = getModule(unext(name.toLowerCase()));
	if (result) {
		console.groupEnd();
		return result;
	}

	//get current script dir
	var currDir = getDir(getAbsolutePath(getCurrentScript().src));

	//get curr package, if any
	var pkg = requestClosestPkg(currDir);


	//if not - try to look up for module
	if (require.lookUpModules) {
		var sourceCode, path;

		//try to map to browser version (defined in "browser" dict in "package.json")
		if (pkg && pkg.browser && typeof pkg.browser !== 'string') {
			name = pkg.browser[name] || pkg.browser[unext(name) + '.js' ] || name;
		}

		//lower
		name = name.toLowerCase();

		//if name starts with path symbols - try to reach relative path
		if (/^\.\.|^[\\\/]|^\.[\\\/]/.test(name)) {
			//if it has extension - request file straightly
			//to ignore things like ., .., ./..
			// ./chai.js, /chai.js
			path = getAbsolutePath(currDir + name);
			if (path.slice(-3) === '.js' || path.slice(-5) === '.json'){
				sourceCode = requestFile(path);
			}

			// ./chai → ./chai.js
			if (!sourceCode) {
				path = getAbsolutePath(currDir + name + '.js');
				sourceCode = requestFile(path);
			}

			// ./chai → ./chai.json
			if (!sourceCode) {
				path = getAbsolutePath(currDir + name + '.json');
				sourceCode = requestFile(path);
			}

			// ./chai → ./chai/index.js
			if (!sourceCode) {
				path = getAbsolutePath(currDir + name + '/index.js');
				sourceCode = requestFile(path);
			}

			//if relative path triggered - set proper name
			// ./chai → module/chai/index.js
			if (sourceCode) {
				// name = name.replace(/^\.\//)
				name = name.replace(/\.[\\\/]/, currDir);
				name = name.replace(pkg._dir, pkg.name + '/');
			}
		}

		//unsuffixize name
		name = unext(name);


		//try to fetch saved in session storage module path
		//has to be after real paths in order to avoid recursions
		if (!sourceCode) {
			path = modulePathsCache[name];
			if (path) sourceCode = requestFile(path);
		}


		//if there is a package named by the first component of the required path - try to fetch module’s file 'a/b'
		if (!sourceCode) {
			var parts = name.split('/');
			if (parts.length > 1) {
				var modulePrefix = parts[0];
				var tpkg;

				//FIXME: ensure basic package is loaded, e. g. require('some-lib/x/y.js')

				if (tpkg = packages[modulePrefix]) {
					var innerPath = getEntry(tpkg, parts.slice(1).join('/'));
					path = getAbsolutePath(tpkg._dir + innerPath);

					sourceCode = requestFile(path);
				}
			}
		}


		//try to fetch dependency from all the known (registered) packages
		if (!sourceCode) {
			var tPkg;
			if (packages[name] && typeof packages[name] !== 'string') {
				tPkg = packages[name];
				path = tPkg._dir + getEntry(tPkg);
				sourceCode = requestFile(path);
			}

			else {
				for (var pkgName in packages) {
					tPkg = packages[pkgName];
					if (tPkg && tPkg.name === name) {
						//fetch browser field beforehead
						path = tPkg._dir + getEntry(tPkg);
						sourceCode = requestFile(path);
						if (sourceCode) break;
					}
				}
			}
		}

		//if is not found, try to reach dependency from the current script's package.json (for modules which are not deps)
		if (!sourceCode && pkg) {
			var pkgDir = pkg._dir;

			//try to reach dependency’s package.json and get path from it
			var depPkg = requestPkg(pkgDir + 'node_modules/' + name + '/');

			if (depPkg) {
				depPkg = normalizePkg(depPkg);
				path = depPkg._dir + getEntry(depPkg);
				sourceCode = requestFile(path);
			}
		}


		//if no folder guessed - try to load from github
		if (require.fetchFromGithub) {}
	}

	//if found - eval script
	if (sourceCode) {
		try {
			evalScript({code: sourceCode, src:path, 'data-module-name': name, 'name': name });
		} catch (e) {
			throw e;
		}
		finally{
			console.groupEnd();
		}

		return getModule(name);
	}

	//close require group
	console.groupEnd();


	//save error to log
	var scriptSrc = getCurrentScript().src;
	scriptSrc = scriptSrc || global.location + '';
	var error = new Error('Can’t find module `' + name + '`. Possibly the module is not installed or package.json is not provided');

	errors.push(error);

	throw error;
}


/** retrieve module from storage by name */
function getModule(name){
	var currDir = getDir(getCurrentScript().src);
	var resolvedName = getAbsolutePath(currDir + name);
	var result = global[name] || global[name[0].toUpperCase() + name.slice(1)] || modules[name] || modules[modulePaths[resolvedName]] || modules[modulePaths[resolvedName+'.js']];

	return result;
}


/**
 * eval & create fake script
 * @param {Object} obj {code: sourceCode, src:path, 'data-module-name': name, 'name': name}
 */
var depth = 0, maxDepth = 30;
function evalScript(obj){
	var name = obj.name;

	//save module here (eval is a final step, so module is found)
	saveModulePath(name, obj.src);

	//create exports for the script
	obj.exports = {};

	// console.groupCollapsed('eval', name)

	//we need to keep fake <script> tags in order to comply with inner require calls, referencing .currentScript and .src attributes
	fakeCurrentScript = obj;
	fakeStack.push(obj);
	fakeCurrentScript.getAttribute = function(name){
		return this[name];
	};


	try {
		//try to eval json first
		if (obj.src.slice(-5) === '.json') {
			global.exports = JSON.parse(obj.code);
		}

		//eval fake script
		else {
			if (depth++ > maxDepth) throw Error('Too deep');
			var code = obj.code;

			//add source urls
			code += '\n//# sourceURL=' + obj.src;
			code += '\n//@ sourceURL=' + obj.src;

			eval(code);
			depth--;
		}
	}

	catch (e){
		//add filename to message
		e.message += ' in ' + obj.src;
		throw e;
	}

	finally {
		fakeStack.pop();
		fakeCurrentScript = fakeStack[fakeStack.length - 1];
	}



	// console.log('endeval', name, getModule(name))
	// console.groupEnd();
}


/** Export module emulation */
var module = global.module = {};


// Listen to `module.exports` change
Object.defineProperty(module, 'exports', {
	configurable: false,
	enumerable: false,
	get: hookExports,
	set: hookExports
});

//Listen to `exports` change
Object.defineProperty(global, 'exports', {
	configurable: false,
	enumerable: false,
	get: hookExports,
	set: hookExports
});


//any time exports required winthin the new script - create a new module
var lastExports, lastScript, lastModuleName;


/** hook for modules/exports accessors */
function hookExports(moduleExports){
	var script = getCurrentScript();

	//if script hasn’t changed - keep current exports
	if (!arguments.length && script === lastScript) return lastExports;

	//if script changed - create a new module with exports
	lastScript = script;
	var moduleName = figureOutModuleName(script);

	//ignore scripts with undefined moduleName/src
	if (!moduleName) throw Error('Can’t figure out module name. Define it via `data-module="name"` attribute on the script.')

	//save new module path
	modulePaths[script.src] = moduleName;
	modulePaths[script.src.toLowerCase()] = moduleName;
	modulePaths[script.getAttribute('src')] = moduleName;

	//if exports.something = ...
	lastExports = moduleExports ? moduleExports : script.exports || {};

	lastModuleName = moduleName;

	// console.log('new module', moduleName);
	//else - save a new module (e.g. enot/index.js)
	modules[moduleName] = lastExports;

	//save no-js module name (e.g. enot/index)
	moduleName = unext(moduleName);
	modules[moduleName] = lastExports;

	//save package name (e.g. enot)
	if (/(?:\/|index(?:\.js|\.json)?)$/.test(moduleName)) {
		moduleName = moduleName.split(/[\\\/]/)[0];
		modules[moduleName] = lastExports;
	}

	return lastExports;
}

/** Session storage source code paths saver */
function saveModulePath(name, val){
	modulePathsCache[name] = val;
	sessionStorage.setItem(modulePathsCacheKey, JSON.stringify(modulePathsCache));
}


/** try to retrieve module name from script tag */
function figureOutModuleName(script){
	//name is clearly defined
	var moduleName = script.getAttribute('data-module-name');

	//return parsed name, if pointed
	if (moduleName) return moduleName.toLowerCase();

	//plugin is in the node_modules
	var path = script.src;

	//catch dirname after last node_modules dirname, if any
	var idx = path.lastIndexOf('node_modules');
	if (idx >= 0){
		path = path.slice(idx);
		var matchResult = /node_modules[\/\\](.+)/.exec(path);
		moduleName = matchResult[1];
	}

	//else take file name as the module name
	if (!moduleName) {
		moduleName = script.getAttribute('src');

		//clear name
		moduleName = moduleName.split(/[\\\/]/).pop().split('.').shift();
	}

	return moduleName.toLowerCase();
}


/** get current script tag, taking into account fake scripts running */
function getCurrentScript(){
	if (fakeCurrentScript) return fakeCurrentScript;

	if (document.currentScript) return document.currentScript;

	var scripts = document.getElementsByTagName('script');
	return scripts[scripts.length - 1];
}



/** return dir from path */
function getDir(path){
	var arr = path.split(/[\\\/]/);
	arr.pop();
	return arr.join('/') + '/';
}


/** return absolute path */
function getAbsolutePath(path){
	var a = document.createElement('a');
	a.href = path;
	var absPath = a.href.split('?')[0];
	absPath = absPath.split('#')[0];
	return absPath;
	// return a.origin + a.pathname;
}


/** return file by path */
function requestFile(path){
	// console.log('resolve', path)
	//FIXME: XHR is forbidden without server. Try to resolve via script/image/etc
	try {
		request = new XMLHttpRequest();

		// `false` makes the request synchronous
		request.open('GET', path, false);
		request.send();
	}

	catch (e) {
		return false;
	}

	finally {
		if (request.status === 200) {
			return request.responseText || request.response;
		}
	}

	return false;
}


/** Return closest package to the path */
function requestClosestPkg(path, force) {
	var file;
	if (path[path.length - 1] === '/') path = path.slice(0, -1);
	while (path) {
		pkg = requestPkg(path, force);
		if (pkg) {
			return pkg;
		}
		path = path.slice(0, path.lastIndexOf('/'));
	}
	return {};
}


/**
 * Return package.json parsed by the path requested, or false
 */
function requestPkg(path, force){
	//return cached pkg
	if (!force && packages[path]) {
		return packages[path];
	}

	if (path[path.length - 1] === '/') path = path.slice(0, -1);
	file = requestFile(path + '/package.json');

	if (file) {
		var result = JSON.parse(file);
		//save path to package.json
		result._dir = path + '/';

		//save package
		var name = result.name || path.slice(path.lastIndexOf('/') + 1);

		//preset pkg name
		if (!result.name) result.name = name;
		normalizePkg(result);

		if (!packages[name]){
			packages[name] = result;
		}

		//save all nested packages
		if (result.dependencies){
			for (var depName in result.dependencies){
				requestPkg(path + '/node_modules/' + depName);
			}
		}
		//save each browser binding as available package
		if (result.browser && typeof result.browser !== 'string'){
			var browserName, ext, parts;
			for (var depName in result.browser){
				browserName = result.browser[depName];
				parts = browserName.split('.');
				ext = parts[parts.length - 1];
				if (parts.length > 1 && /json|js|html/.test(ext)) {
					packages[depName] = browserName.replace(/^\./, name);
				}
				//require bound pkg
				else {
					packages[depName] = requestPkg(browserName);
				}
			}
		}
		if (require.loadDevDeps) {
			if (result.devDependencies){
				for (var depName in result.devDependencies){
					requestPkg(path + '/node_modules/' + depName);
				}
			}
		}

		return result;
	}
	return;
}


/** Normalize package fields */
function normalizePkg(pkg){
	if (!pkg.main) {
		pkg.main = 'index';
	}

	// pkg.main = normalizePath(pkg.main);

	if (!pkg.browser) {
		pkg.browser = pkg.main;
	}

	if (typeof pkg.browser === 'string') {
		pkg.browser = normalizePath(pkg.browser);
	}


	return pkg;
}

/** Ensure path points to a file w/o shortcuts */
function normalizePath(path){
	if (path[path.length - 1] === '/' || path[path.length - 1] === '\\'){
		path += 'index.js';
	}
	else if (path.slice(-3) !== '.js' && path.slice(-5) !== '.json' && path.slice(-5) !== '.html') {
		path = unext(path) + '.js';
	}

	return path;
}

/** Get entry file from the package */
function getEntry(pkg, name){
	if (pkg) {
		if (!name) name = pkg.main || 'index.js';

		if (pkg.browser) {
			if (typeof pkg.browser === 'string') {
				name = pkg.browser;
			} else if (pkg.browser[name] || pkg.browser[normalizePath(name)]) {
				name = pkg.browser[name] || pkg.browser[normalizePath(name)];
			}
		}
	}

	return normalizePath(name);
}


/**
 * Get rid of .extension
 */
function unext(name){
	if (/\.[a-z]+$/.test(name)) return name.split('.').slice(0, -1).join('.');
	return name;
}


})(window);