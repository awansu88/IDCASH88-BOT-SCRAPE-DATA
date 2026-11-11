import { FilterProfile } from '../../types/filter-profile';
import { ConfigManager } from './config-manager';
import { getLogger } from './logger-service';
import { profileTag } from '../../utils/safe-diagnostics';

export class FilterManager {
  private filters: FilterProfile[] = [];
  
  constructor(private configManager: ConfigManager) {}
  
  async loadProfiles(): Promise<void> {
    this.filters = await this.configManager.loadFilterProfiles();
    getLogger().info(`Loaded ${this.filters.length} filter profiles`);
  }
  
  getEnabledProfiles(): FilterProfile[] {
    return this.filters
      .filter(f => f.enabled)
      .sort((a, b) => a.priority - b.priority);
  }
  
  getAllProfiles(): FilterProfile[] {
    return [...this.filters];
  }
  
  async createProfile(profile: Omit<FilterProfile, 'id'>): Promise<FilterProfile> {
    const newProfile: FilterProfile = {
      id: this.generateId(),
      ...profile
    };
    
    this.filters.push(newProfile);
    await this.configManager.saveFilterProfiles(this.filters);
    getLogger().info(`Created filter: ${profileTag(newProfile.name)}`);
    
    return newProfile;
  }
  
  async updateProfile(id: string, updates: Partial<FilterProfile>): Promise<void> {
    const index = this.filters.findIndex(f => f.id === id);
    if (index === -1) throw new Error(`Filter not found: profileTag=${profileTag(id)}`);
    
    this.filters[index] = { ...this.filters[index], ...updates, id };
    await this.configManager.saveFilterProfiles(this.filters);
    getLogger().info(`Updated filter: ${profileTag(this.filters[index].name)}`);
  }
  
  async deleteProfile(id: string): Promise<void> {
    const index = this.filters.findIndex(f => f.id === id);
    if (index === -1) throw new Error(`Filter not found: profileTag=${profileTag(id)}`);
    
    const name = this.filters[index].name;
    this.filters.splice(index, 1);
    await this.configManager.saveFilterProfiles(this.filters);
    getLogger().info(`Deleted filter: ${profileTag(name)}`);
  }
  
  private generateId(): string {
    return `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
