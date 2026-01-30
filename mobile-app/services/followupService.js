import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = 'https://sak-ai.saksolution.ae/api/mobile';

class FollowupService {
  // Get authentication headers
  async getAuthHeaders() {
    const salesmanPhone = await AsyncStorage.getItem('salesmanPhone');
    const salesmanPassword = await AsyncStorage.getItem('salesmanPassword');
    const tenantId = await AsyncStorage.getItem('tenantId');
    const userId = await AsyncStorage.getItem('userId');

    if (userId && tenantId) {
      return {
        'Authorization': `Bearer ${userId}`,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json'
      };
    } else if (salesmanPhone && salesmanPassword && tenantId) {
      return {
        'X-Salesman-Phone': salesmanPhone,
        'X-Salesman-Password': salesmanPassword,
        'X-Tenant-Id': tenantId,
        'Content-Type': 'application/json'
      };
    }

    throw new Error('Not authenticated');
  }

  // Get all followups
  async getFollowups(status = 'pending', limit = 50) {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.get(`${API_BASE_URL}/followups`, {
        headers,
        params: { status, limit }
      });
      return response.data;
    } catch (error) {
      console.error('Get followups error:', error);
      throw error;
    }
  }

  // Create new followup
  async createFollowup(data) {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.post(`${API_BASE_URL}/followups`, data, { headers });
      return response.data;
    } catch (error) {
      console.error('Create followup error:', error);
      throw error;
    }
  }

  // Mark followup as complete
  async completeFollowup(conversationId, completionNote = '') {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.put(
        `${API_BASE_URL}/followups/${conversationId}/complete`,
        { completionNote },
        { headers }
      );
      return response.data;
    } catch (error) {
      console.error('Complete followup error:', error);
      throw error;
    }
  }

  // Delete/cancel followup
  async deleteFollowup(conversationId) {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.delete(
        `${API_BASE_URL}/followups/${conversationId}`,
        { headers }
      );
      return response.data;
    } catch (error) {
      console.error('Delete followup error:', error);
      throw error;
    }
  }

  // Get auto-followups
  async getAutoFollowups() {
    try {
      const headers = await this.getAuthHeaders();
      const response = await axios.get(`${API_BASE_URL}/followups/auto`, { headers });
      return response.data;
    } catch (error) {
      console.error('Get auto followups error:', error);
      throw error;
    }
  }
}

export default new FollowupService();
