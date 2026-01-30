/**
 * Location Service for React Native
 * Handles GPS tracking and geolocation
 */

import Geolocation from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform } from 'react-native';
import api from './api';

class LocationService {
  constructor() {
    this.watchId = null;
    this.currentLocation = null;
  }

  /**
   * Request location permissions
   */
  async requestPermissions() {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'Salesmate needs access to your location for check-ins and route tracking.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        console.error('[LOCATION] Permission error:', err);
        return false;
      }
    }
    // iOS permissions are requested automatically
    return true;
  }

  /**
   * Get current location
   */
  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        position => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp
          };
          this.currentLocation = location;
          resolve(location);
        },
        error => {
          console.error('[LOCATION] Get current location error:', error);
          reject(error);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });
  }

  /**
   * Start watching location (for real-time tracking)
   */
  startWatching(callback) {
    if (this.watchId !== null) {
      console.log('[LOCATION] Already watching location');
      return;
    }

    this.watchId = Geolocation.watchPosition(
      position => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp
        };
        this.currentLocation = location;
        if (callback) callback(location);
      },
      error => {
        console.error('[LOCATION] Watch error:', error);
      },
      { enableHighAccuracy: true, distanceFilter: 10 }
    );

    console.log('[LOCATION] Started watching location');
  }

  /**
   * Stop watching location
   */
  stopWatching() {
    if (this.watchId !== null) {
      Geolocation.clearWatch(this.watchId);
      this.watchId = null;
      console.log('[LOCATION] Stopped watching location');
    }
  }

  /**
   * Record location to server
   */
  async recordLocation(latitude, longitude, accuracy) {
    try {
      const response = await api.post('/api/location/record', {
        latitude,
        longitude,
        accuracy
      });
      return response.data;
    } catch (error) {
      console.error('[LOCATION] Record error:', error);
      throw error;
    }
  }

  /**
   * Check in at customer location
   */
  async checkIn(customerId, visitType, conversationId = null) {
    try {
      const location = await this.getCurrentLocation();

      const response = await api.post('/api/location/check-in', {
        customerId,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        visitType,
        conversationId
      });

      return response.data;
    } catch (error) {
      console.error('[LOCATION] Check-in error:', error);
      throw error;
    }
  }

  /**
   * Check out from customer location
   */
  async checkOut(visitId, notes, outcome) {
    try {
      const location = await this.getCurrentLocation();

      const response = await api.post('/api/location/check-out', {
        visitId,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        notes,
        outcome
      });

      return response.data;
    } catch (error) {
      console.error('[LOCATION] Check-out error:', error);
      throw error;
    }
  }

  /**
   * Get visit history
   */
  async getVisitHistory(days = 30) {
    try {
      const response = await api.get(`/api/location/visits?days=${days}`);
      return response.data;
    } catch (error) {
      console.error('[LOCATION] Get visits error:', error);
      throw error;
    }
  }

  /**
   * Optimize route for customers
   */
  async optimizeRoute(customerIds, routeDate = null) {
    try {
      const location = await this.getCurrentLocation();

      const response = await api.post('/api/location/optimize-route', {
        customerIds,
        startLatitude: location.latitude,
        startLongitude: location.longitude,
        routeDate
      });

      return response.data;
    } catch (error) {
      console.error('[LOCATION] Optimize route error:', error);
      throw error;
    }
  }

  /**
   * Get today's route
   */
  async getRoute(date = null) {
    try {
      const url = date ? `/api/location/route?date=${date}` : '/api/location/route';
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('[LOCATION] Get route error:', error);
      throw error;
    }
  }

  /**
   * Start route
   */
  async startRoute(routeId) {
    try {
      const response = await api.put(`/api/location/route/${routeId}/start`);
      return response.data;
    } catch (error) {
      console.error('[LOCATION] Start route error:', error);
      throw error;
    }
  }

  /**
   * Complete route
   */
  async completeRoute(routeId) {
    try {
      const response = await api.put(`/api/location/route/${routeId}/complete`);
      return response.data;
    } catch (error) {
      console.error('[LOCATION] Complete route error:', error);
      throw error;
    }
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }
}

export default new LocationService();
