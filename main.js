const { Plugin, Notice, TFile, TFolder, Modal, Setting, PluginSettingTab, moment } = require('obsidian');
const path = require('path');

module.exports = class FileFlexPlugin extends Plugin {
    async onload() {
        this.history = [];
        this.currentHistoryIndex = -1;
        this.isUndoing = false;
        this.isNotificationActive = false;
        this.lastSuccessTimestamp = 0;

        // Load settings
        await this.loadSettings();

        // Register event listeners for file operations
        this.registerEvent(this.app.vault.on('rename', this.handleFileRename.bind(this)));

        // Add ribbon icon and menu item for history navigation
        const ribbonIconEl = this.addRibbonIcon('rotate-ccw', 'File Flex', async () => await this.undo());
        ribbonIconEl.addClass('file-flex-ribbon-class');

        // Register commands
        this.addCommand({
            id: 'file-flex-undo',
            name: 'Undo',
            callback: async () => await this.undo()
        });

        this.addCommand({
            id: 'file-flex-clear-cache',
            name: 'Clear cache',
            callback: async () => await this.clearCache()
        });

        // Add settings tab
        this.addSettingTab(new FileFlexSettingTab(this.app, this));
    }

    async handleFileRename(file, oldPath) {
        if (this.isUndoing) {
            return;
        }

        const changeType = file.path.startsWith(oldPath.substring(0, oldPath.lastIndexOf('/') + 1)) ? 'rename' : 'move';
        const now = Date.now();

        // Filter out operations older than the time window
        this.history = this.history.filter(op => now - op.timestamp <= this.settings.timeWindow * 1000);

        // Create or update the batch operation
        let existingOperation = this.history.find(op => op.timestamp + this.settings.timeWindow * 1000 > now && op.type === changeType);
        if (!existingOperation) {
            existingOperation = {
                type: changeType,
                files: [],
                timestamp: now
            };
            this.history.push(existingOperation);
            this.currentHistoryIndex = this.history.length - 1;
        }

        existingOperation.files.push({ file, oldPath, newPath: file.path });

        // Log only during development
        if (process.env.NODE_ENV === 'development') {
            console.log(`Tracked operation: ${changeType} - ${file.path} from ${oldPath}`);
        }
    }

    async undo() {
        const now = Date.now();

        // Check if the history is empty or if the latest operation is older than the time window
        if (this.currentHistoryIndex < 0 || now - this.history[this.currentHistoryIndex].timestamp > this.settings.timeWindow * 1000) {
            return;
        }

        const operation = this.history[this.currentHistoryIndex];

        this.isUndoing = true;

        for (const fileOp of operation.files) {
            const file = this.app.vault.getAbstractFileByPath(fileOp.newPath);
            if (file) {
                try {
                    await this.app.vault.rename(file, fileOp.oldPath);

                    // Log only during development
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`Successfully moved ${fileOp.newPath} to ${fileOp.oldPath}`);
                    }
                } catch (error) {
                    console.error(`Error moving ${fileOp.newPath} to ${fileOp.oldPath}:`, error);
                }
            } else {
                console.error(`File ${fileOp.newPath} not found for undo`);
            }
        }

        this.history.pop();
        this.currentHistoryIndex = this.history.length - 1;
        this.isUndoing = false;

        new Notice(`File Flex\n---\n'Undo' successful`);
    }

    async clearCache() {
        this.history = [];
        this.currentHistoryIndex = -1;
        new Notice('File Flex cache cleared');
    }

    async loadSettings() {
        this.settings = Object.assign({}, {
            timeWindow: 10 // Default time window value in seconds
        }, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class FileFlexSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        // Add custom CSS
        const style = document.createElement('style');
        style.textContent = `
            .file-flex-slider-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                width: 100%;
                margin-bottom: 1em;
            }
            .file-flex-slider {
                width: 80%;
            }
            .file-flex-slider-count {
                margin-bottom: 1em;
            }
        `;
        document.head.appendChild(style);

        // Time Window setting
        const sliderContainer = containerEl.createDiv({ cls: 'file-flex-slider-container' });

        const sliderCount = sliderContainer.createDiv({ cls: 'file-flex-slider-count' });
        const sliderValueDisplay = sliderCount.createEl('span', { text: `${this.plugin.settings.timeWindow} seconds` });

        const sliderSetting = new Setting(sliderContainer)
            .setName('Time window')
            .setDesc('Set the time window (between 3 seconds and 1 minute) for undo operations. Smaller time windows are better for vaults with more frequent file / folder name and location changes.')
            .addSlider(slider => {
                slider
                    .setLimits(3, 60, 1)
                    .setValue(this.plugin.settings.timeWindow)
                    .onChange(async (value) => {
                        this.plugin.settings.timeWindow = value;
                        sliderValueDisplay.textContent = `${value} seconds`;
                        await this.plugin.saveSettings();
                    });
                slider.sliderEl.addClass('file-flex-slider');
            });

        // Clear Cache setting
        new Setting(containerEl)
            .setName('Clear cache')
            .setDesc('Clear the File Flex cache. Useful if you want to prevent undo of old operations.')
            .addButton(button => button
                .setButtonText('Clear cache')
                .onClick(async () => {
                    await this.plugin.clearCache();
                }));

        containerEl.createEl('hr');

        containerEl.createEl('p', { text: 'GitHub Repository: ' });
        const link = containerEl.createEl('a', { href: 'https://github.com/19msb/obsidian-file-flex', text: 'https://github.com/19msb/obsidian-file-flex' });
        link.style.display = 'block';

        containerEl.createEl('hr');
        
        containerEl.createEl('p', { text: ' If you find this plugin useful and would like to support its development, you can buy me a coffee:' });    
        // Add the Ko-fi button at the end
        const koFiButton = containerEl.createEl('a', { href: 'https://ko-fi.com/I2I2ZHYPA', target: '_blank' });
        koFiButton.createEl('img', {
            attr: {
                height: '36',
                style: 'border:0px;height:36px;',
                src: 'https://storage.ko-fi.com/cdn/kofi2.png?v=3',
                border: '0',
                alt: 'Buy Me a Coffee at ko-fi.com'
            }
        });
        koFiButton.style.display = 'block';
        koFiButton.style.textAlign = 'center';
    }
}