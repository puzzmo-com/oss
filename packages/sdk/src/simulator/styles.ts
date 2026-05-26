export const simulatorStyles = `
  :root {
    --sim-bg: #1a1a2e;
    --sim-bg-alt: #16213e;
    --sim-panel: #0f0f1a;
    --sim-border: #3a3a5c;
    --sim-border-light: #5a5a8c;
    --sim-accent: #ffd700;
    --sim-accent-hover: #ffed4a;
    --sim-text: #e8e8e8;
    --sim-text-dim: #888899;
    --sim-success: #4ade80;
    --sim-error: #f87171;
    --sim-warning: #fbbf24;
    --sim-blue: #60a5fa;
  }
  #simulator {
    position: fixed;
    bottom: 4px;
    left: 4px;
    z-index: 999999;
    font: 11px/1.4 "Menlo", "Monaco", "Consolas", monospace;
    user-select: none;
  }
  #simulator-panel {
    background: var(--sim-panel);
    border: 2px solid var(--sim-border);
    border-radius: 4px;
    color: var(--sim-text);
    width: 420px;
    max-width: calc(100vw - 8px);
    box-shadow: 4px 4px 0 rgba(0,0,0,0.5);
  }
  #simulator-panel.collapsed {
    width: auto;
  }
  #simulator-header {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    background: var(--sim-bg);
    border-bottom: 2px solid var(--sim-border);
    gap: 0;
  }
  #simulator-panel.collapsed #simulator-header {
    border-bottom: none;
    cursor: pointer;
  }
  #simulator-panel.collapsed #simulator-header:hover {
    background: var(--sim-bg-alt);
  }
  .header-sep {
    color: var(--sim-border-light);
    margin: 0 8px;
    opacity: 0.6;
  }
  .header-spacer {
    flex: 1;
  }
  #simulator-title {
    color: var(--sim-accent);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: 10px;
    font-weight: bold;
  }
  #simulator-header-controls {
    display: flex;
    gap: 2px;
  }
  .header-icon-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 2px;
    color: var(--sim-text);
    cursor: pointer;
    padding: 0;
  }
  .header-icon-btn:hover:not(:disabled) {
    background: var(--sim-border);
    color: var(--sim-accent);
  }
  .header-icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .header-icon-btn.active {
    background: var(--sim-accent);
    color: var(--sim-panel);
  }
  #simulator-header-status {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    color: var(--sim-text-dim);
  }
  #simulator-header-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--sim-text-dim);
    flex-shrink: 0;
  }
  #simulator-header-indicator.ready {
    background: var(--sim-success);
    box-shadow: 0 0 4px var(--sim-success);
  }
  #simulator-header-indicator.waiting {
    background: var(--sim-warning);
    box-shadow: 0 0 4px var(--sim-warning);
  }
  #simulator-header-indicator.paused {
    background: var(--sim-error);
    box-shadow: 0 0 4px var(--sim-error);
  }
  #simulator-header-indicator.complete {
    background: transparent;
    box-shadow: none;
    color: var(--sim-success);
    width: auto;
    height: auto;
    font-size: 11px;
    line-height: 1;
    font-weight: bold;
  }
  #simulator-timer {
    font-size: 11px;
    color: var(--sim-text);
    font-family: "Menlo", monospace;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    min-width: 38px;
  }
  #simulator-timer .penalty {
    color: var(--sim-error);
    margin-left: 2px;
  }
  /* Collapsed state - show minimal bar */
  #simulator-panel.collapsed .header-sep,
  #simulator-panel.collapsed #simulator-header-controls,
  #simulator-panel.collapsed #simulator-header-status,
  #simulator-panel.collapsed #simulator-header-settings,
  #simulator-panel.collapsed #simulator-toggle {
    display: none;
  }
  #simulator-panel.collapsed #simulator-title {
    cursor: pointer;
  }
  #simulator-panel.collapsed #simulator-timer {
    margin-left: 8px;
  }
  #simulator-body {
    display: flex;
    flex-direction: row;
  }
  #simulator-panel.collapsed #simulator-body {
    display: none;
  }
  #simulator-tabs {
    display: flex;
    flex-direction: column;
    background: var(--sim-bg);
    padding: 4px;
    gap: 2px;
    border-right: 2px solid var(--sim-border);
  }
  .simulator-tab {
    padding: 2px 3px;
    background: var(--sim-bg-alt);
    border: 2px solid var(--sim-border);
    border-radius: 2px;
    color: var(--sim-text-dim);
    cursor: pointer;
    font: inherit;
    text-transform: uppercase;
    font-size: 9px;
    font-weight: bold;
    letter-spacing: 0.5px;
    min-height: 0;
  }
  .simulator-tab:hover {
    color: var(--sim-text);
    background: var(--sim-border);
  }
  .simulator-tab.active {
    color: var(--sim-panel);
    background: var(--sim-accent);
    border-color: var(--sim-accent);
  }
  .simulator-tab {
    position: relative;
  }
  .simulator-tab-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    background: var(--sim-blue);
    color: #fff;
    font-size: 8px;
    font-weight: bold;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    line-height: 1;
    text-align: center;
    box-sizing: border-box;
  }
  .simulator-tab-badge:empty {
    display: none;
  }
  #simulator-content {
    padding: 6px;
    background: var(--sim-panel);
    height: 500px;
    flex: 1;
    overflow-y: auto;
  }
  #simulator-content.hidden {
    display: none;
  }
  #simulator-content::-webkit-scrollbar {
    width: 8px;
  }
  #simulator-content::-webkit-scrollbar-track {
    background: var(--sim-bg);
  }
  #simulator-content::-webkit-scrollbar-thumb {
    background: var(--sim-border);
    border-radius: 2px;
  }
  .simulator-btn {
    padding: 4px 8px;
    background: var(--sim-bg-alt);
    border: 2px solid var(--sim-border);
    border-radius: 2px;
    color: var(--sim-text);
    font: inherit;
    font-size: 10px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
    cursor: pointer;
  }
  .simulator-btn:hover {
    background: var(--sim-border);
    border-color: var(--sim-border-light);
  }
  .simulator-btn:active {
    transform: translate(1px, 1px);
  }
  .simulator-btn.primary {
    background: var(--sim-accent);
    border-color: var(--sim-accent);
    color: var(--sim-panel);
  }
  .simulator-btn.primary:hover {
    background: var(--sim-accent-hover);
    border-color: var(--sim-accent-hover);
  }
  .simulator-btn.danger {
    background: var(--sim-error);
    border-color: var(--sim-error);
    color: #fff;
  }
  .simulator-btn.danger:hover {
    background: #ef4444;
    border-color: #ef4444;
  }
  .simulator-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }
  .simulator-btn.subtle {
    background: transparent;
    border-color: transparent;
    color: var(--sim-text-dim);
  }
  .simulator-btn.subtle:hover:not(:disabled) {
    background: var(--sim-bg-alt);
    border-color: var(--sim-border);
    color: var(--sim-text);
  }
  #simulator-status {
    font-size: 10px;
    color: var(--sim-text-dim);
    padding: 4px 0 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  #simulator-status .indicator {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--sim-text-dim);
  }
  #simulator-status .indicator.ready {
    background: var(--sim-success);
    box-shadow: 0 0 6px var(--sim-success);
  }
  #simulator-status .indicator.waiting {
    background: var(--sim-warning);
    box-shadow: 0 0 6px var(--sim-warning);
  }
  #simulator-status .indicator.paused {
    background: var(--sim-error);
    box-shadow: 0 0 6px var(--sim-error);
  }
  #simulator-status .indicator.complete {
    background: transparent;
    box-shadow: none;
    color: var(--sim-success);
    width: auto;
    height: auto;
    font-size: 12px;
    line-height: 1;
    font-weight: bold;
  }
  .simulator-row {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }
  .simulator-row .simulator-btn {
    flex: 1;
  }
  .simulator-divider {
    height: 2px;
    background: var(--sim-border);
    margin: 8px 0;
  }
  .simulator-field {
    margin-bottom: 6px;
  }
  .simulator-select {
    width: 100%;
    padding: 4px 6px;
    background: var(--sim-bg);
    border: 2px solid var(--sim-border);
    border-radius: 2px;
    color: var(--sim-text);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .simulator-select:focus {
    outline: none;
    border-color: var(--sim-accent);
  }
  .simulator-select option {
    background: var(--sim-bg);
    color: var(--sim-text);
  }
  .simulator-fixtures {
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--sim-border);
  }
  .simulator-label {
    display: block;
    color: var(--sim-accent);
    text-transform: uppercase;
    font-size: 9px;
    font-weight: bold;
    letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .simulator-textarea {
    width: 100%;
    min-height: 40px;
    background: var(--sim-bg);
    border: 2px solid var(--sim-border);
    border-radius: 2px;
    color: var(--sim-text);
    font: 10px/1.4 "Menlo", monospace;
    padding: 4px;
    resize: none;
    box-sizing: border-box;
    overflow-y: auto;
  }
  .simulator-textarea.auto-resize {
    resize: none;
    overflow-y: auto;
  }
  .simulator-textarea:focus {
    outline: none;
    border-color: var(--sim-accent);
  }
  .simulator-input {
    width: 100%;
    background: var(--sim-bg);
    border: 2px solid var(--sim-border);
    border-radius: 2px;
    color: var(--sim-text);
    font: 10px/1.4 "Menlo", monospace;
    padding: 4px 6px;
    box-sizing: border-box;
  }
  .simulator-input:focus {
    outline: none;
    border-color: var(--sim-accent);
  }
  .simulator-input::placeholder {
    color: var(--sim-text-dim);
  }
  .simulator-tab-content {
    display: none;
  }
  .simulator-tab-content.active {
    display: block;
  }
  .msgs-view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .msgs-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    flex-shrink: 0;
  }
  #simulator-msgs-log {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    overflow-y: auto;
  }
  .simulator-msg {
    padding: 3px 4px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
    font-size: 10px;
  }
  .simulator-msg.out {
    border-left: 2px solid var(--sim-accent);
  }
  .simulator-msg.in {
    border-left: 2px solid var(--sim-blue);
  }
  .simulator-msg-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
  }
  .simulator-msg-type {
    font-weight: bold;
    color: var(--sim-text);
  }
  .simulator-msg.out .simulator-msg-type {
    color: var(--sim-accent);
  }
  .simulator-msg.in .simulator-msg-type {
    color: var(--sim-blue);
  }
  .simulator-msg-time {
    color: var(--sim-text-dim);
    font-size: 9px;
  }
  .simulator-msg-data {
    color: var(--sim-text-dim);
    font-size: 9px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 60px;
    overflow: hidden;
    cursor: pointer;
    border-radius: 2px;
    padding: 2px 4px;
    background: var(--sim-bg-alt);
  }
  .simulator-msg-data:hover {
    background: var(--sim-border);
  }
  .simulator-msg.expanded {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .simulator-msg.expanded .simulator-msg-data {
    max-height: none;
    flex: 1;
    overflow-y: auto;
  }
  .simulator-empty {
    color: var(--sim-text-dim);
    font-size: 10px;
    text-align: center;
    padding: 20px;
  }
  .simulator-value {
    color: var(--sim-text);
    font-size: 10px;
    padding: 4px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
  }
  .simulator-deeds {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .simulator-deed {
    display: flex;
    justify-content: space-between;
    padding: 3px 4px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
    font-size: 10px;
  }
  .simulator-deed-name {
    color: var(--sim-text);
  }
  .simulator-deed-value {
    color: var(--sim-accent);
    font-weight: bold;
  }
  .thumb-view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .thumb-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    flex-shrink: 0;
  }
  #simulator-thumb-preview {
    background: var(--sim-thumb-bg, transparent);
    border: 2px solid var(--sim-border);
    border-radius: 2px;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    width: 100%;
    box-sizing: border-box;
  }
  #simulator-thumb-preview svg {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
  }
  #simulator-thumb-fn {
    font-size: 10px;
    color: var(--sim-text-dim);
    margin-top: 4px;
  }
  .theme-view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .theme-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    flex-shrink: 0;
  }
  .simulator-themes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    overflow-y: auto;
  }
  .simulator-theme-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
    background: var(--sim-bg);
    border: 2px solid var(--sim-border);
    border-radius: 2px;
    cursor: pointer;
  }
  .simulator-theme-item:hover {
    border-color: var(--sim-border-light);
  }
  .simulator-theme-item.selected {
    border-color: var(--sim-accent);
    background: var(--sim-bg-alt);
  }
  .simulator-theme-preview {
    width: 48px;
    height: 32px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 1px;
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .simulator-theme-preview-cell {
    width: 100%;
    height: 100%;
  }
  .simulator-theme-name {
    font-size: 10px;
    color: var(--sim-text);
    flex: 1;
  }
  .simulator-theme-type {
    font-size: 9px;
    color: var(--sim-text-dim);
    text-transform: uppercase;
  }
  /* Auth tab styles */
  .simulator-section {
    margin-bottom: 12px;
  }
  .simulator-section-title {
    color: var(--sim-accent);
    text-transform: uppercase;
    font-size: 10px;
    font-weight: bold;
    letter-spacing: 1px;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--sim-border);
  }
  .auth-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .auth-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: var(--sim-text-dim);
    padding: 4px 0;
  }
  .auth-status.authenticated {
    color: var(--sim-success);
  }
  .simulator-btn.small {
    padding: 2px 6px;
    font-size: 9px;
  }
  .simulator-btn.tiny {
    padding: 3px 2px;
    font-size: 8px;
    border-width: 1px;
    line-height: 1;
    min-height: 0;
    height: auto;
  }
  .auth-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .auth-title-row > span:first-child {
    flex: 1;
  }
  .auth-title-row .simulator-btn.active {
    background: var(--sim-accent);
    color: black;
  }
  .auth-description {
    font-size: 10px;
    color: var(--sim-text-dim);
    margin: 6px 0;
    line-height: 1.4;
  }
  .auth-user-info {
    font-size: 10px;
    color: var(--sim-text-dim);
    padding: 6px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
    margin-bottom: 8px;
  }
  .auth-user-info div {
    margin-bottom: 4px;
  }
  .auth-user-info div:last-child {
    margin-bottom: 0;
  }
  .auth-user-info code {
    color: var(--sim-text);
    background: var(--sim-bg-alt);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .auth-warning {
    color: var(--sim-warning);
    font-style: italic;
  }
  .auth-error {
    margin-top: 8px;
  }
  .auth-error .error,
  .auth-api-result .error {
    color: var(--sim-error);
    font-size: 10px;
    padding: 6px;
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid var(--sim-error);
    border-radius: 2px;
  }
  .auth-api-result {
    margin-top: 8px;
  }
  .auth-api-result pre {
    font-size: 9px;
    color: var(--sim-text);
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
    padding: 6px;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 150px;
    overflow-y: auto;
  }
  .auth-api-result .loading {
    font-size: 10px;
    color: var(--sim-text-dim);
    padding: 6px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
  }
  /* Data view styles */
  .data-view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .data-subtabs {
    display: flex;
    gap: 2px;
    margin-bottom: 8px;
    flex-shrink: 0;
  }
  .data-subtab {
    padding: 4px 10px;
    background: var(--sim-bg-alt);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
    color: var(--sim-text-dim);
    cursor: pointer;
    font: inherit;
    font-size: 9px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .data-subtab:hover {
    color: var(--sim-text);
    background: var(--sim-border);
  }
  .data-subtab.active {
    color: var(--sim-panel);
    background: var(--sim-accent);
    border-color: var(--sim-accent);
  }
  .data-subtab-content {
    display: none;
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .data-subtab-content.active {
    display: flex;
    flex-direction: column;
  }
  /* History tab styles */
  .history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    flex-shrink: 0;
  }
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    overflow-y: auto;
  }
  .history-item {
    padding: 6px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
    display: flex;
    flex-direction: row;
    gap: 8px;
  }
  .history-item:hover {
    border-color: var(--sim-border-light);
  }
  .history-item-thumb {
    width: 80px;
    height: 80px;
    flex-shrink: 0;
    background: var(--history-thumb-bg, var(--sim-bg-alt));
    border: 1px solid var(--sim-border);
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .history-item-thumb svg {
    width: 100%;
    height: 100%;
  }
  .history-item-thumb:empty {
    display: none;
  }
  .history-item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .history-item-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .history-item-num {
    color: var(--sim-accent);
    font-weight: bold;
    font-size: 9px;
  }
  .history-item-time {
    color: var(--sim-text-dim);
    font-size: 9px;
    flex: 1;
  }
  .history-item-preview {
    font-size: 9px;
    color: var(--sim-text);
    word-break: break-all;
    line-height: 1.3;
    background: var(--sim-bg-alt);
    padding: 3px 4px;
    border-radius: 2px;
    flex: 1;
    overflow: hidden;
  }
  /* Saves tab styles */
  .save-new {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
    flex-shrink: 0;
  }
  .save-new .simulator-input {
    flex: 1;
  }
  .saves-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    overflow-y: auto;
  }
  .save-item {
    padding: 6px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
  }
  .save-item:hover {
    border-color: var(--sim-border-light);
  }
  .save-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .save-item-name {
    color: var(--sim-text);
    font-weight: bold;
    font-size: 10px;
  }
  .save-item-time {
    color: var(--sim-text-dim);
    font-size: 9px;
  }
  .save-item-actions {
    display: flex;
    gap: 4px;
  }
  /* Features view styles */
  .features-view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .features-slug-input {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }
  .features-slug-input .simulator-input {
    flex: 1;
  }
  .features-content {
    flex: 1;
    overflow-y: auto;
  }
  .features-loading {
    color: var(--sim-text-dim);
    font-size: 10px;
    text-align: center;
    padding: 20px;
  }
  .features-error {
    color: var(--sim-error);
    font-size: 10px;
    padding: 8px;
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid var(--sim-error);
    border-radius: 2px;
  }
  .features-empty {
    color: var(--sim-text-dim);
    font-size: 10px;
    text-align: center;
    padding: 20px;
  }
  .features-auth-required {
    color: var(--sim-text-dim);
    font-size: 10px;
    padding: 12px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
    line-height: 1.5;
  }
  .features-auth-required p {
    margin: 0 0 8px 0;
  }
  .features-auth-required p:last-child {
    margin-bottom: 0;
  }
  .features-game-name {
    color: var(--sim-accent);
    font-size: 11px;
    font-weight: bold;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--sim-border);
  }
  .feature-group {
    margin-bottom: 12px;
  }
  .feature-group-title {
    color: var(--sim-text);
    font-size: 10px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    padding-bottom: 2px;
    border-bottom: 1px solid var(--sim-border);
  }
  .feature-group-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .feature-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .feature-item:hover {
    border-color: var(--sim-border-light);
    background: var(--sim-bg-alt);
  }
  .feature-item.updating {
    opacity: 0.5;
    pointer-events: none;
  }
  .feature-status {
    font-size: 14px;
    width: 18px;
    text-align: center;
    flex-shrink: 0;
  }
  .feature-item.enabled .feature-status {
    color: var(--sim-success);
  }
  .feature-item.disabled .feature-status {
    color: var(--sim-error);
    opacity: 0.5;
  }
  .feature-title {
    font-size: 10px;
    color: var(--sim-text);
    flex: 1;
  }
  .feature-item.disabled .feature-title {
    color: var(--sim-text-dim);
  }
  /* Checkpoints view styles */
  .checkpoints-view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .checkpoints-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    flex-shrink: 0;
  }
  .checkpoints-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    overflow-y: auto;
  }
  .checkpoint-item {
    padding: 6px;
    background: var(--sim-bg);
    border: 1px solid var(--sim-border);
    border-left: 3px solid var(--sim-accent);
    border-radius: 2px;
  }
  .checkpoint-item:hover {
    border-color: var(--sim-border-light);
    border-left-color: var(--sim-accent);
  }
  .checkpoint-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .checkpoint-item .simulator-deeds {
    margin-top: 4px;
  }
  .checkpoint-name {
    color: var(--sim-accent);
    font-weight: bold;
    font-size: 10px;
  }
  .checkpoint-time {
    color: var(--sim-text-dim);
    font-size: 9px;
  }
  /* Keyboard view styles */
  .keyboard-view-container {
    padding: 4px;
  }
  .sim-kb-empty {
    color: var(--sim-text-dim);
    text-align: center;
    padding: 16px 8px;
    font-size: 10px;
    line-height: 1.6;
  }
  .sim-kb-empty code {
    background: var(--sim-bg);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 10px;
  }
  .sim-kb {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sim-kb-row {
    display: flex;
    justify-content: center;
    gap: 3px;
  }
  .sim-kb-key {
    min-width: 28px;
    height: 30px;
    padding: 0 4px;
    border: 1px solid var(--sim-border);
    border-radius: 3px;
    background: var(--sim-bg);
    color: var(--sim-text);
    font: inherit;
    font-size: 11px;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sim-kb-key:hover {
    background: var(--sim-bg-alt);
    border-color: var(--sim-border-light);
  }
  .sim-kb-key:active {
    background: var(--sim-accent);
    color: var(--sim-panel);
  }
  .sim-kb-key.highlight {
    background: var(--sim-bg-alt);
    border-color: var(--sim-accent);
    color: var(--sim-accent);
    font-size: 9px;
  }
  .sim-kb-key.highlight:active {
    background: var(--sim-accent);
    color: var(--sim-panel);
  }
  .sim-kb-key.l {
    min-width: 40px;
  }
  .sim-kb-key.xl {
    min-width: 52px;
  }
  .sim-kb-key.grow {
    flex: 1;
  }
  .sim-kb-key.disabled {
    opacity: 0.3;
    cursor: default;
  }
`
