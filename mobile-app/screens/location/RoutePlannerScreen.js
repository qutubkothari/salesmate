/**
 * Route Planner Screen - Optimize daily routes
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import locationService from '../services/locationService';

const RoutePlannerScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState(null);
  const [optimizedRoute, setOptimizedRoute] = useState(null);
  const [selectedCustomers, setSelectedCustomers] = useState([]);

  useEffect(() => {
    loadTodayRoute();
  }, []);

  const loadTodayRoute = async () => {
    try {
      setLoading(true);
      const result = await locationService.getRoute();
      
      if (result.success && result.route) {
        setRoute(result.route);
        if (result.route.optimized_order) {
          setOptimizedRoute(JSON.parse(result.route.optimized_order));
        }
      }
    } catch (error) {
      console.error('Error loading route:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOptimizeRoute = async () => {
    if (selectedCustomers.length === 0) {
      Alert.alert('Error', 'Please select at least one customer to visit');
      return;
    }

    try {
      setLoading(true);
      
      const result = await locationService.optimizeRoute(
        selectedCustomers.map(c => c.id),
        new Date().toISOString().split('T')[0]
      );

      if (result.success) {
        setOptimizedRoute(result.optimizedOrder);
        setRoute({
          total_customers: result.totalCustomers,
          total_distance_km: result.totalDistanceKm,
          estimated_duration_minutes: result.estimatedDurationMinutes,
          optimization_algorithm: result.algorithm
        });

        Alert.alert(
          'Route Optimized!',
          `Total distance: ${result.totalDistanceKm} km\nEstimated time: ${Math.floor(result.estimatedDurationMinutes / 60)}h ${result.estimatedDurationMinutes % 60}m`
        );
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to optimize route: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartRoute = async () => {
    if (!route || !route.id) {
      Alert.alert('Error', 'No route to start');
      return;
    }

    try {
      setLoading(true);
      const result = await locationService.startRoute(route.id);
      
      if (result.success) {
        setRoute({ ...route, status: 'in_progress', started_at: result.route.started_at });
        Alert.alert('Success', 'Route started! Safe driving!');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to start route: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteRoute = async () => {
    if (!route || !route.id) {
      Alert.alert('Error', 'No route to complete');
      return;
    }

    Alert.alert(
      'Complete Route',
      'Have you finished all visits for today?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete',
          onPress: async () => {
            try {
              setLoading(true);
              const result = await locationService.completeRoute(route.id);
              
              if (result.success) {
                setRoute({ ...route, status: 'completed', completed_at: result.route.completed_at });
                Alert.alert('Success', 'Route completed! Great job!');
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to complete route: ' + error.message);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const renderCustomerStop = ({ item, index }) => {
    const isFirst = index === 0;
    const distanceKm = item.distanceFromPrevious 
      ? (item.distanceFromPrevious / 1000).toFixed(1) 
      : null;

    return (
      <View style={styles.stopCard}>
        <View style={styles.stopNumber}>
          <Text style={styles.stopNumberText}>{index + 1}</Text>
        </View>
        
        <View style={styles.stopInfo}>
          <Text style={styles.customerName}>{item.customerName}</Text>
          {item.city && (
            <Text style={styles.customerCity}>📍 {item.city}</Text>
          )}
          {!isFirst && distanceKm && (
            <Text style={styles.distance}>
              🚗 {distanceKm} km from previous stop
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={styles.navigateButton}
          onPress={() => {
            // Open maps for navigation
            Alert.alert('Navigate', `Open maps to navigate to ${item.customerName}?`);
          }}
        >
          <Icon name="navigation" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>
    );
  };

  if (loading && !route) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading route...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Route Summary */}
      {route && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Icon name="place" size={24} color="#007AFF" />
              <Text style={styles.summaryValue}>{route.total_customers || 0}</Text>
              <Text style={styles.summaryLabel}>Stops</Text>
            </View>
            
            <View style={styles.summaryItem}>
              <Icon name="directions-car" size={24} color="#34C759" />
              <Text style={styles.summaryValue}>{route.total_distance_km || 0} km</Text>
              <Text style={styles.summaryLabel}>Distance</Text>
            </View>
            
            <View style={styles.summaryItem}>
              <Icon name="access-time" size={24} color="#FF9500" />
              <Text style={styles.summaryValue}>
                {route.estimated_duration_minutes 
                  ? `${Math.floor(route.estimated_duration_minutes / 60)}h ${route.estimated_duration_minutes % 60}m`
                  : '0h'}
              </Text>
              <Text style={styles.summaryLabel}>Est. Time</Text>
            </View>
          </View>

          <View style={styles.statusRow}>
            <View style={[
              styles.statusBadge,
              route.status === 'in_progress' && styles.statusInProgress,
              route.status === 'completed' && styles.statusCompleted
            ]}>
              <Text style={styles.statusText}>
                {route.status === 'planned' && '📋 Planned'}
                {route.status === 'in_progress' && '🚗 In Progress'}
                {route.status === 'completed' && '✅ Completed'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Customer Stops */}
      {optimizedRoute && optimizedRoute.length > 0 && (
        <View style={styles.stopsSection}>
          <Text style={styles.sectionTitle}>
            Route ({optimizedRoute.length} stops)
          </Text>
          <FlatList
            data={optimizedRoute}
            keyExtractor={(item, index) => `stop-${index}`}
            renderItem={renderCustomerStop}
            contentContainerStyle={styles.stopsList}
          />
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        {(!route || route.status === 'planned') && (
          <TouchableOpacity
            style={styles.startButton}
            onPress={handleStartRoute}
            disabled={loading || !route}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Icon name="play-arrow" size={24} color="#fff" />
                <Text style={styles.buttonText}>Start Route</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {route && route.status === 'in_progress' && (
          <TouchableOpacity
            style={styles.completeButton}
            onPress={handleCompleteRoute}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Icon name="check-circle" size={24} color="#fff" />
                <Text style={styles.buttonText}>Complete Route</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {(!route || route.status === 'completed') && (
          <TouchableOpacity
            style={styles.optimizeButton}
            onPress={handleOptimizeRoute}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Icon name="route" size={24} color="#fff" />
                <Text style={styles.buttonText}>Plan New Route</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5'
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5'
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666'
  },
  summaryCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: '#E5E5E5'
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 15
  },
  summaryItem: {
    alignItems: 'center'
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginTop: 5
  },
  summaryLabel: {
    fontSize: 12,
    color: '#999',
    marginTop: 2
  },
  statusRow: {
    alignItems: 'center'
  },
  statusBadge: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#E5E5E5'
  },
  statusInProgress: {
    backgroundColor: '#E8F4FF'
  },
  statusCompleted: {
    backgroundColor: '#E8F8EC'
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666'
  },
  stopsSection: {
    flex: 1
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    padding: 20,
    paddingBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  stopsList: {
    paddingHorizontal: 15
  },
  stopCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2
  },
  stopNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12
  },
  stopNumberText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff'
  },
  stopInfo: {
    flex: 1
  },
  customerName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    marginBottom: 4
  },
  customerCity: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2
  },
  distance: {
    fontSize: 12,
    color: '#999'
  },
  navigateButton: {
    padding: 8
  },
  actionButtons: {
    padding: 20,
    borderTopWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#fff'
  },
  startButton: {
    flexDirection: 'row',
    backgroundColor: '#34C759',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  completeButton: {
    flexDirection: 'row',
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  optimizeButton: {
    flexDirection: 'row',
    backgroundColor: '#FF9500',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonText: {
    marginLeft: 8,
    fontSize: 18,
    fontWeight: '600',
    color: '#fff'
  }
});

export default RoutePlannerScreen;
