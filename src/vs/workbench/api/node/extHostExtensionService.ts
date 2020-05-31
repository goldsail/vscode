/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createApiFactoryAndRegisterActors } from 'vs/workbench/api/common/extHost.api.impl';
import { RequireInterceptor } from 'vs/workbench/api/common/extHostRequireInterceptor';
import { MainContext } from 'vs/workbench/api/common/extHost.protocol';
import { ExtensionActivationTimesBuilder } from 'vs/workbench/api/common/extHostExtensionActivator';
import { connectProxyResolver } from 'vs/workbench/services/extensions/node/proxyResolver';
import { AbstractExtHostExtensionService } from 'vs/workbench/api/common/extHostExtensionService';
import { ExtHostDownloadService } from 'vs/workbench/api/node/extHostDownloadService';
import { CLIServer } from 'vs/workbench/api/node/extHostCLIServer';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import {NodeVM, NodeVMOptions} from 'vm2';
import * as fs from 'fs';
import * as https from 'https';
import * as vscode from 'vscode';

class NodeModuleRequireInterceptor extends RequireInterceptor {

	protected _installInterceptor(): void {
		const that = this;
		const node_module = <any>require.__$__nodeRequire('module');
		const original = node_module._load;
		node_module._load = function load(request: string, parent: { filename: string; }, isMain: any) {
			for (let alternativeModuleName of that._alternatives) {
				let alternative = alternativeModuleName(request);
				if (alternative) {
					request = alternative;
					break;
				}
			}
			if (!that._factories.has(request)) {
				return original.apply(this, arguments);
			}
			return that._factories.get(request)!.load(
				request,
				URI.file(parent.filename),
				request => original.apply(this, [request, parent, isMain])
			);
		};
	}
}

export class ExtHostExtensionService extends AbstractExtHostExtensionService {

	protected async _beforeAlmostReadyToRunExtensions(): Promise<void> {
		// initialize API and register actors
		const extensionApiFactory = this._instaService.invokeFunction(createApiFactoryAndRegisterActors);

		// Register Download command
		this._instaService.createInstance(ExtHostDownloadService);

		// Register CLI Server for ipc
		if (this._initData.remote.isRemote && this._initData.remote.authority) {
			const cliServer = this._instaService.createInstance(CLIServer);
			process.env['VSCODE_IPC_HOOK_CLI'] = cliServer.ipcHandlePath;
		}

		// Module loading tricks
		const interceptor = this._instaService.createInstance(NodeModuleRequireInterceptor, extensionApiFactory, this._registry);
		await interceptor.install();

		// Do this when extension service exists, but extensions are not being activated yet.
		const configProvider = await this._extHostConfiguration.getConfigProvider();
		await connectProxyResolver(this._extHostWorkspace, configProvider, this, this._logService, this._mainThreadTelemetryProxy, this._initData);

		// Use IPC messages to forward console-calls, note that the console is
		// already patched to use`process.send()`
		const nativeProcessSend = process.send!;
		const mainThreadConsole = this._extHostContext.getProxy(MainContext.MainThreadConsole);
		process.send = (...args) => {
			if ((args as unknown[]).length === 0 || !args[0] || args[0].type !== '__$console') {
				return nativeProcessSend.apply(process, args);
			}
			mainThreadConsole.$logExtensionHostMessage(args[0]);
			return false;
		};
	}

	protected _loadCommonJSModule<T>(module: URI, activationTimesBuilder: ExtensionActivationTimesBuilder): Promise<T> {
		if (module.scheme !== Schemas.file) {
			throw new Error(`Cannot load URI: '${module}', must be of file-scheme`);
		}
		let r: T | null = null;
		activationTimesBuilder.codeLoadingStart();
		this._logService.info(`ExtensionService#loadCommonJSModule ${module.toString(true)}`);
		this._logService.flush();
		try {
			let jsPath = module.fsPath;
			if (!module.fsPath.endsWith('.js')) {
				jsPath += '.js';
			}

			let resolve = (moduleName: string, parentDirName: string) => {
				return jsPath.split('/out')[0];
			};

			let script = fs.readFileSync(jsPath, {encoding:'utf8', flag:'r'});
			let vscode = require.__$__nodeRequire('vscode');

			let httpsMock = {
				createServer() {throw Error('Extensions are not allowed to create servers');},
				get(options, callback) {
					let message = "";
					switch (Object.prototype.toString.call(options).slice(8, -1)) {
						case "String":
							message = "Attempting to connect to " + options + ".  Proceed?";
							break;
						case "URL":
							message = "Attempting to connect to " + options.URL + ".  Proceed?";
							break;
						case "Object":
							message = "Attempting to connect to " + options.path + ".  Proceed?";

					};

					vscode.window
						.showInformationMessage(message, ...['Allow', 'Reject'])
						.then(result => {
					        	if (result === 'Reject') {
								throw Error("User not okay with the call");
							} else {
								https.get(options, callback);
							}
						});
				},
				get(url, options, callback) {
					let message = "";
					switch(Object.prototype.toString.call(url).slice(8, -1) {
						case "String":
							message = "Attempting to connect to " + url + ".  Proceed?";
							break;
						case "URL":
							message = "Attempting to connect to " url.URL + ".  Proceed?";
					}

					vscode.window
						.showInformationMessage(message, ...['Allow', 'Reject'])
						.then(result => {
							if (result === 'Reject') {
								throw Error("User not okay with the call");
							} else {
								https.get(url, options, callback);
							}
						});
				},
				request(options, callback) {
					let message = "";
					switch (Object.prototype.toString.call(options).slice(8, -1) {
						case "String":
							message = "Attempting to connect to " + options + ".  Proceed?";
							break;
						case "URL":
							message = "Attempting to connect to " + options.URL + ".  Proceed?";
							break;
						case "Object":
							message = "Attempting to connect to " + options.path + ".  Proceed?";

					}

					vscode.window
						.showInformationMessage(message, ...['Allow', 'Reject'])
						.then(result => {
					        	if (result === 'Reject') {
								throw Error("User not okay with the call");
							} else {
								https.get(options, callback);
							}
						});
				},
				request(url, options, callback) {
					let message = "";
					switch(Object.prototype.toString.call(url).slice(8, -1) {
						case "String":
							message = "Attempting to connect to " + url + ".  Proceed?";
							break;
						case "URL":
							message = "Attempting to connect to " url.URL + ".  Proceed?";
					}

					vscode.window
						.showInformationMessage(message, ...['Allow', 'Reject'])
						.then(result => {
							if (result === 'Reject') {
								throw Error("User not okay with the call");
							} else {
								https.get(url, options, callback);
							}
						});
				}
			}

			let options: NodeVMOptions = {
				sandbox: {vscode},
				require: {
					context: 'sandbox',
					mock: {
						https: httpsMock,
						vscode: vscode
					},
					external: {
						modules: ['vscode', 'vscode-nls'],
						transitive: false
					},
					builtin: ['assert', 'buffer', 'crypto', 'events', 'https', 'path', 'timers', 'tls', 'util', 'vm'],
					// builtin: ['*'],
					resolve: resolve
				}
			};
			r = <T>new NodeVM(options).run(script, jsPath);
		} catch (e) {
			console.error(e);
			return Promise.reject(e);
		} finally {
			activationTimesBuilder.codeLoadingStop();
		}
		return Promise.resolve(r);
	}

	public async $setRemoteEnvironment(env: { [key: string]: string | null }): Promise<void> {
		if (!this._initData.remote.isRemote) {
			return;
		}

		for (const key in env) {
			const value = env[key];
			if (value === null) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}
