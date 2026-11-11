import fs from 'fs';
import { AppConfig } from '../../types/config';
import { FilterProfile } from '../../types/filter-profile';
import { GoogleSheetsConfig } from '../../types/google-sheets';
import { AppDirectoryManager } from './app-directory-manager';
import { getLogger } from './logger-service';
import { diagnosticError } from '../../utils/safe-diagnostics';
import { DEFAULT_CONFIG } from '../../utils/constants';

export class ConfigManager {
  constructor(private appDirManager: AppDirectoryManager) {}
  
  async loadAppConfig(): Promise<AppConfig> {
    const configPath = this.appDirManager.getAppConfigPath();
    
    if (!fs.existsSync(configPath)) {
      const defaultConfig = this.getDefaultConfig();
      await this.saveAppConfig(defaultConfig);
      return defaultConfig;
    }
    
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      getLogger().error('Failed to load app configuration', diagnosticError(error));
      return this.getDefaultConfig();
    }
  }
  
  async saveAppConfig(config: AppConfig): Promise<void> {
    const configPath = this.appDirManager.getAppConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    getLogger().info('App configuration saved');
  }
  
  async loadFilterProfiles(): Promise<FilterProfile[]> {
    const profilesPath = this.appDirManager.getFilterProfilesPath();
    
    if (!fs.existsSync(profilesPath)) {
      await this.saveFilterProfiles([]);
      return [];
    }
    
    try {
      const profilesData = fs.readFileSync(profilesPath, 'utf8');
      return JSON.parse(profilesData);
    } catch (error) {
      getLogger().error('Failed to load filter profiles', diagnosticError(error));
      return [];
    }
  }
  
  async saveFilterProfiles(profiles: FilterProfile[]): Promise<void> {
    const profilesPath = this.appDirManager.getFilterProfilesPath();
    fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), 'utf8');
    getLogger().info(`Saved ${profiles.length} filter profiles`);
  }
  
  async loadGoogleSheetsConfig(): Promise<GoogleSheetsConfig | null> {
    const configPath = this.appDirManager.getGoogleSheetsConfigPath();
    
    if (!fs.existsSync(configPath)) return null;
    
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      if (config.lastConnectionTest) {
        config.lastConnectionTest = new Date(config.lastConnectionTest);
      }
      return config;
    } catch (error) {
      getLogger().error('Failed to load Google Sheets configuration', diagnosticError(error));
      return null;
    }
  }
  
  async saveGoogleSheetsConfig(config: GoogleSheetsConfig): Promise<void> {
    const configPath = this.appDirManager.getGoogleSheetsConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    getLogger().info('Google Sheets configuration saved');
  }
  
  private getDefaultConfig(): AppConfig {
    return {
      version: '1.0.0',
      ...DEFAULT_CONFIG
    };
  }
}
