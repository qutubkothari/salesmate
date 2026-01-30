/**
 * Check-In Screen - Check in/out at customer locations
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import locationService from '../services/locationService';

const CheckInScreen = ({ route, navigation }) => {
  const { customer, followupId } = route.params || {};
  
  const [loading, setLoading] = useState(false);
  const [visitType, setVisitType] = useState('follow_up');
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [visitId, setVisitId] = useState(null);
  const [checkInTime, setCheckInTime] = useState(null);
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState('successful');
  const [locationStatus, setLocationStatus] = useState(null);

  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    const granted = await locationService.requestPermissions();
    if (!granted) {
      Alert.alert('Permission Denied', 'Location permission is required for check-ins.');
    }
  };

  const handleCheckIn = async () => {
    if (!customer) {
      Alert.alert('Error', 'Customer information is missing');
      return;
    }

    try {
      setLoading(true);
      setLocationStatus('Getting location...');

      const result = await locationService.checkIn(
        customer.id,
        visitType,
        followupId
      );

      if (result.success) {
        setIsCheckedIn(true);
        setVisitId(result.visitId);
        setCheckInTime(result.checkInTime);
        
        let message = 'Checked in successfully!';
        if (result.distanceFromCustomer) {
          message += `\n\nDistance from customer: ${Math.round(result.distanceFromCustomer)}m`;
        }
        if (!result.geoFenceValid && result.geoFenceWarning) {
          message += `\n\n⚠️ ${result.geoFenceWarning}`;
        }

        Alert.alert('Success', message);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to check in: ' + error.message);
    } finally {
      setLoading(false);
      setLocationStatus(null);
    }
  };

  const handleCheckOut = async () => {
    if (!visitId) {
      Alert.alert('Error', 'No active check-in found');
      return;
    }

    try {
      setLoading(true);
      setLocationStatus('Getting location...');

      const result = await locationService.checkOut(visitId, notes, outcome);

      if (result.success) {
        Alert.alert(
          'Success',
          `Checked out successfully!\n\nVisit duration: ${result.durationMinutes} minutes`,
          [
            {
              text: 'OK',
              onPress: () => navigation.goBack()
            }
          ]
        );
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to check out: ' + error.message);
    } finally {
      setLoading(false);
      setLocationStatus(null);
    }
  };

  const visitTypes = [
    { value: 'follow_up', label: 'Follow-up', icon: 'event' },
    { value: 'cold_call', label: 'Cold Call', icon: 'phone' },
    { value: 'delivery', label: 'Delivery', icon: 'local-shipping' },
    { value: 'service', label: 'Service', icon: 'build' }
  ];

  const outcomes = [
    { value: 'successful', label: 'Successful', color: '#34C759' },
    { value: 'not_available', label: 'Not Available', color: '#FF9500' },
    { value: 'rescheduled', label: 'Rescheduled', color: '#007AFF' },
    { value: 'cancelled', label: 'Cancelled', color: '#FF3B30' }
  ];

  return (
    <ScrollView style={styles.container}>
      {/* Customer Info */}
      <View style={styles.customerCard}>
        <Icon name="person" size={40} color="#007AFF" />
        <View style={styles.customerInfo}>
          <Text style={styles.customerName}>{customer?.name || 'Unknown Customer'}</Text>
          <Text style={styles.customerPhone}>{customer?.phone}</Text>
          {customer?.city && (
            <Text style={styles.customerCity}>📍 {customer.city}</Text>
          )}
        </View>
      </View>

      {!isCheckedIn ? (
        /* Check-In Section */
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visit Type</Text>
          <View style={styles.typeGrid}>
            {visitTypes.map(type => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.typeButton,
                  visitType === type.value && styles.typeButtonActive
                ]}
                onPress={() => setVisitType(type.value)}
              >
                <Icon 
                  name={type.icon} 
                  size={24} 
                  color={visitType === type.value ? '#007AFF' : '#666'}
                />
                <Text style={[
                  styles.typeLabel,
                  visitType === type.value && styles.typeLabelActive
                ]}>
                  {type.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {locationStatus && (
            <View style={styles.statusBar}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.statusText}>{locationStatus}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.checkInButton}
            onPress={handleCheckIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Icon name="location-on" size={24} color="#fff" />
                <Text style={styles.checkInButtonText}>Check In</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        /* Check-Out Section */
        <View style={styles.section}>
          <View style={styles.checkedInBanner}>
            <Icon name="check-circle" size={24} color="#34C759" />
            <Text style={styles.checkedInText}>Checked In</Text>
            <Text style={styles.checkInTimeText}>
              {new Date(checkInTime).toLocaleTimeString()}
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Visit Outcome</Text>
          <View style={styles.outcomeGrid}>
            {outcomes.map(item => (
              <TouchableOpacity
                key={item.value}
                style={[
                  styles.outcomeButton,
                  outcome === item.value && { 
                    borderColor: item.color,
                    backgroundColor: item.color + '15'
                  }
                ]}
                onPress={() => setOutcome(item.value)}
              >
                <Text style={[
                  styles.outcomeLabel,
                  outcome === item.value && { color: item.color }
                ]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Visit Notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Enter visit notes..."
            placeholderTextColor="#999"
            multiline
            numberOfLines={4}
            value={notes}
            onChangeText={setNotes}
          />

          {locationStatus && (
            <View style={styles.statusBar}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.statusText}>{locationStatus}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.checkOutButton}
            onPress={handleCheckOut}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Icon name="exit-to-app" size={24} color="#fff" />
                <Text style={styles.checkOutButtonText}>Check Out</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5'
  },
  customerCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 20,
    marginTop: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E5E5',
    alignItems: 'center'
  },
  customerInfo: {
    marginLeft: 15,
    flex: 1
  },
  customerName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4
  },
  customerPhone: {
    fontSize: 16,
    color: '#666',
    marginBottom: 4
  },
  customerCity: {
    fontSize: 14,
    color: '#999'
  },
  section: {
    backgroundColor: '#fff',
    marginTop: 20,
    padding: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E5E5'
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 15,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -5
  },
  typeButton: {
    width: '47%',
    margin: '1.5%',
    padding: 15,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    borderWidth: 2,
    borderColor: '#E5E5E5',
    alignItems: 'center'
  },
  typeButtonActive: {
    backgroundColor: '#E8F4FF',
    borderColor: '#007AFF'
  },
  typeLabel: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#666'
  },
  typeLabelActive: {
    color: '#007AFF'
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
    padding: 10,
    backgroundColor: '#F0F8FF',
    borderRadius: 8
  },
  statusText: {
    marginLeft: 10,
    fontSize: 14,
    color: '#007AFF'
  },
  checkInButton: {
    flexDirection: 'row',
    backgroundColor: '#34C759',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20
  },
  checkInButtonText: {
    marginLeft: 8,
    fontSize: 18,
    fontWeight: '600',
    color: '#fff'
  },
  checkedInBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F8EC',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20
  },
  checkedInText: {
    marginLeft: 10,
    fontSize: 16,
    fontWeight: '600',
    color: '#34C759',
    flex: 1
  },
  checkInTimeText: {
    fontSize: 14,
    color: '#666'
  },
  outcomeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -5,
    marginBottom: 20
  },
  outcomeButton: {
    width: '47%',
    margin: '1.5%',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    borderWidth: 2,
    borderColor: '#E5E5E5',
    alignItems: 'center'
  },
  outcomeLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666'
  },
  notesInput: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#000',
    textAlignVertical: 'top',
    marginBottom: 20
  },
  checkOutButton: {
    flexDirection: 'row',
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10
  },
  checkOutButtonText: {
    marginLeft: 8,
    fontSize: 18,
    fontWeight: '600',
    color: '#fff'
  }
});

export default CheckInScreen;
