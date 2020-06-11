import * as fs from 'fs';

interface AccessPolicy {
	r: [string];
	w: [string];
}

/**
 * Check if the path is accessible given the policy.
 * If not, throw an exception.
 * @param policy access policy
 * @param path path
 * @param mode 'r' or 'w'
 */
// TODO: now path can only be string
function checkAccessibility(policy: AccessPolicy, path: string, mode: string) {
	const accessiblePaths: [string] = policy[mode];
	// if (! accessiblePaths.some(parentPath => (fs.realpathSync(path).indexOf(fs.realpathSync(parentPath)) == 0))) {
	//     throw new Error(`${fs.realpathSync(path)} is inaccessible!`);
	// }
}


// Read global and local manifest files
// and return the access policy
// TODO
function resolveAccessPolicy(extensionName: string): AccessPolicy {
	return { r: ['/'], w: ['/'] };
}


// f is either path or file descriptor
// since we impose access control on open(),
// we only need to validate path.
const oneFileFuncWrapper = (func: any, policy: AccessPolicy, mode: string) => (f: any, ...args: any) => {
	if (typeof f !== 'number') { checkAccessibility(policy, f, mode); }
	return func(f, ...args);
};

// p1 and p2 are simply paths
const twoPathsFuncWrapper = (func: any, policy: AccessPolicy, _: any) => (p1: string, p2: string, ...args: any) => {
	checkAccessibility(policy, p1, 'r');
	checkAccessibility(policy, p2, 'w');
	func(p1, p2, ...args);
};

// TODO: now accepting string flags only
// (path[, flags[, mode]], callback)
const openFuncWrapper = (func: any, policy: AccessPolicy, _: any) => (p: string, flgs?: any, ...args: any) => {
	let mode = 'r';
	if (typeof flgs === 'string') {
		let fst = flgs.charAt(0);
		mode = ((fst === 'a' || fst === 'w') ? 'w' : 'r');
	}

	checkAccessibility(policy, p, mode);
	return func(p, flgs, ...args);
};



const functionTypes = {
	oneFileFunctions: {
		functions: [
			{ name: 'chmod', mode: 'w' },
			{ name: 'chown', mode: 'w' },
			{ name: 'lchmod', mode: 'w' },
			{ name: 'lchown', mode: 'w' },
			{ name: 'mkdir', mode: 'w' },
			{ name: 'readdir', mode: 'r' },
			{ name: 'readlink', mode: 'r' },
			{ name: 'rmdir', mode: 'w' },
			{ name: 'truncate', mode: 'w' },
			{ name: 'unlink', mode: 'w' },
			{ name: 'utimes', mode: 'w' },
			{ name: 'mkdtemp', mode: 'w' },
			{ name: 'appendFile', mode: 'w' },
			{ name: 'readFile', mode: 'r' },
			{ name: 'writeFile', mode: 'w' }
		],
		wrapper: oneFileFuncWrapper,
		hasSyncCounterpart: true,
	},
	oneFileNonSyncFunctions: {
		functions: [
			{ name: 'createReadStream', mode: 'r' },
			{ name: 'createWriteStream', mode: 'w' },
		],
		wrapper: oneFileFuncWrapper,
		hasSyncCounterpart: false,
	},
	twoPathsFunctions: {
		functions: [
			{ name: 'copyFile', mode: 'rw' },
			{ name: 'link', mode: 'rw' },
			{ name: 'rename', mode: 'rw' },
			{ name: 'symlink', mode: 'rw' }
		],
		wrapper: twoPathsFuncWrapper,
		hasSyncCounterpart: true
	},
	openFunctions: {
		functions: [
			{ name: 'open', mode: 'rw' }
		],
		wrapper: openFuncWrapper,
		hasSyncCounterpart: true,
	}
};


export function make(extensionName: string) {
	let policy: AccessPolicy = resolveAccessPolicy(extensionName);
	let wrapped = {};
	for (const typeName of Object.keys(functionTypes)) {
		const type = functionTypes[typeName];
		for (let func of type['functions']) {
			const name = func['name'], mode = func['mode'];
			wrapped[name] = type.wrapper(fs[name], policy, mode);
			if (type.hasSyncCounterpart) {
				const syncName = name + 'Sync';
				wrapped[syncName] = type.wrapper(fs[syncName], policy, mode);
			}
		}
	}
	return { ...fs, ...wrapped };
}
