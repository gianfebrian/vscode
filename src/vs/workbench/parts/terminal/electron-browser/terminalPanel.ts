/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import DOM = require('vs/base/browser/dom');
import lifecycle = require('vs/base/common/lifecycle');
import platform = require('vs/base/common/platform');
import {Action, IAction} from 'vs/base/common/actions';
import {Builder, Dimension} from 'vs/base/browser/builder';
import {KillTerminalAction, CreateNewTerminalAction, SwitchTerminalInstanceAction, SwitchTerminalInstanceActionItem} from 'vs/workbench/parts/terminal/electron-browser/terminalActions';
import {IActionItem} from 'vs/base/browser/ui/actionbar/actionbar';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {ITelemetryService} from 'vs/platform/telemetry/common/telemetry';
import {ITerminalProcess, ITerminalService, TERMINAL_PANEL_ID} from 'vs/workbench/parts/terminal/electron-browser/terminal';
import {IThemeService} from 'vs/workbench/services/themes/common/themeService';
import {IWorkspaceContextService} from 'vs/platform/workspace/common/workspace';
import {Panel} from 'vs/workbench/browser/panel';
import {TPromise} from 'vs/base/common/winjs.base';
import {TerminalConfigHelper} from 'vs/workbench/parts/terminal/electron-browser/terminalConfigHelper';
import {TerminalInstance} from 'vs/workbench/parts/terminal/electron-browser/terminalInstance';

export class TerminalPanel extends Panel {

	private toDispose: lifecycle.IDisposable[] = [];
	private terminalInstances: TerminalInstance[] = [];

	private actions: IAction[];
	private parentDomElement: HTMLElement;
	private terminalContainer: HTMLElement;
	private themeStyleElement: HTMLElement;
	private configurationHelper: TerminalConfigHelper;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@ITerminalService private terminalService: ITerminalService,
		@IThemeService private themeService: IThemeService
	) {
		super(TERMINAL_PANEL_ID, telemetryService);
	}

	public layout(dimension?: Dimension): void {
		if (!dimension) {
			return;
		}
		let activeIndex = this.terminalService.getActiveTerminalIndex();
		if (activeIndex !== -1 && this.terminalInstances.length > 0) {
			this.terminalInstances[this.terminalService.getActiveTerminalIndex()].layout(dimension);
		}
	}

	public getActions(): IAction[] {
		if (!this.actions) {
			this.actions = [
				this.instantiationService.createInstance(SwitchTerminalInstanceAction, SwitchTerminalInstanceAction.ID, SwitchTerminalInstanceAction.LABEL),
				this.instantiationService.createInstance(CreateNewTerminalAction, CreateNewTerminalAction.ID, CreateNewTerminalAction.LABEL),
				this.instantiationService.createInstance(KillTerminalAction, KillTerminalAction.ID, KillTerminalAction.LABEL)
			];

			this.actions.forEach(a => {
				this.toDispose.push(a);
			});
		}

		return this.actions;
	}

	public getActionItem(action: Action): IActionItem {
		if (action.id === SwitchTerminalInstanceAction.ID) {
			return this.instantiationService.createInstance(SwitchTerminalInstanceActionItem, action);
		}

		return super.getActionItem(action);
	}

	public create(parent: Builder): TPromise<void> {
		super.create(parent);
		this.parentDomElement = parent.getHTMLElement();
		this.terminalService.initConfigHelper(parent);
		DOM.addClass(this.parentDomElement, 'integrated-terminal');
		this.themeStyleElement = document.createElement('style');

		this.terminalContainer = document.createElement('div');
		DOM.addClass(this.terminalContainer, 'terminal-outer-container');
		this.parentDomElement.appendChild(this.themeStyleElement);
		this.parentDomElement.appendChild(this.terminalContainer);

		this.configurationHelper = new TerminalConfigHelper(platform.platform, this.configurationService, parent);
		this.toDispose.push(DOM.addDisposableListener(this.terminalContainer, 'wheel', (event: WheelEvent) => {
			this.terminalInstances[this.terminalService.getActiveTerminalIndex()].dispatchEvent(new WheelEvent(event.type, event));
		}));

		return this.terminalService.createNew();
	}

	public createNewTerminalInstance(terminalProcess: ITerminalProcess): TPromise<void> {
		return this.createTerminal(terminalProcess).then(() => {
			this.updateFont();
			this.focus();
		});
	}

	public closeActiveTerminal(): TPromise<void> {
		return this.closeTerminal(this.terminalService.getActiveTerminalIndex());
	}

	public closeTerminal(index: number): TPromise<void> {
		let self = this;
		return new TPromise<void>(resolve => {
			self.onTerminalInstanceExit(self.terminalInstances[index]);
		});
	}

	public setVisible(visible: boolean): TPromise<void> {
		if (visible) {
			if (this.terminalInstances.length > 0) {
				this.updateFont();
				this.updateTheme();
			} else {
				return super.setVisible(visible).then(() => {
					this.terminalService.createNew();
				});
			}
		}
		return super.setVisible(visible);
	}

	private createTerminal(terminalProcess: ITerminalProcess): TPromise<TerminalInstance> {
		return new TPromise<TerminalInstance>(resolve => {
			var terminalInstance = new TerminalInstance(terminalProcess, this.terminalContainer, this.contextService, this.terminalService, this.onTerminalInstanceExit.bind(this));
			this.terminalInstances.push(terminalInstance);
			this.setActiveTerminal(this.terminalInstances.length - 1);
			this.toDispose.push(this.themeService.onDidThemeChange(this.updateTheme.bind(this)));
			this.toDispose.push(this.configurationService.onDidUpdateConfiguration(this.updateFont.bind(this)));
			this.toDispose.push(this.configurationService.onDidUpdateConfiguration(this.updateCursorBlink.bind(this)));
			resolve(terminalInstance);
		});
	}

	public setActiveTerminal(newActiveIndex: number) {
		this.terminalInstances.forEach((terminalInstance, i) => {
			terminalInstance.toggleVisibility(i === newActiveIndex);
		});
	}

	private onTerminalInstanceExit(terminalInstance: TerminalInstance): void {
		let index = this.terminalInstances.indexOf(terminalInstance);
		if (index !== -1) {
			this.terminalInstances[index].dispose();
			this.terminalInstances.splice(index, 1);
		}
		if (this.terminalInstances.length > 0) {
			this.setActiveTerminal(this.terminalService.getActiveTerminalIndex());
		}
		if (this.terminalInstances.length === 0) {
			this.terminalService.hide();
		} else {
			this.terminalService.focus();
		}
	}

	private updateTheme(themeId?: string): void {
		if (!themeId) {
			themeId = this.themeService.getTheme();
		}
		let theme = this.configurationHelper.getTheme(themeId);

		let css = '';
		theme.forEach((color: string, index: number) => {
			let rgba = this.convertHexCssColorToRgba(color, 0.996);
			css += `.monaco-workbench .panel.integrated-terminal .xterm .xterm-color-${index} { color: ${color}; }` +
				`.monaco-workbench .panel.integrated-terminal .xterm .xterm-color-${index}::selection { background-color: ${rgba}; }` +
				`.monaco-workbench .panel.integrated-terminal .xterm .xterm-bg-color-${index} { background-color: ${color}; }` +
				`.monaco-workbench .panel.integrated-terminal .xterm .xterm-bg-color-${index}::selection { color: ${color}; }`;
		});

		this.themeStyleElement.innerHTML = css;
	}

	/**
	 * Converts a CSS hex color (#rrggbb) to a CSS rgba color (rgba(r, g, b, a)).
	 */
	private convertHexCssColorToRgba(hex: string, alpha: number): string {
		let r = parseInt(hex.substr(1, 2), 16);
		let g = parseInt(hex.substr(3, 2), 16);
		let b = parseInt(hex.substr(5, 2), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	private updateFont(): void {
		if (this.terminalInstances.length === 0) {
			return;
		}
		this.terminalInstances[this.terminalService.getActiveTerminalIndex()].setFont(this.configurationHelper.getFont());
		this.layout(new Dimension(this.parentDomElement.offsetWidth, this.parentDomElement.offsetHeight));
	}

	private updateCursorBlink(): void {
		this.terminalInstances.forEach((instance) => {
			instance.setCursorBlink(this.configurationHelper.getCursorBlink());
		});
	}

	public focus(): void {
		let activeIndex = this.terminalService.getActiveTerminalIndex();
		if (activeIndex !== -1 && this.terminalInstances.length > 0) {
			this.terminalInstances[activeIndex].focus(true);
		}
	}

	public dispose(): void {
		this.toDispose = lifecycle.dispose(this.toDispose);
		while (this.terminalInstances.length > 0) {
			this.terminalInstances.pop().dispose();
		}
		super.dispose();
	}
}
