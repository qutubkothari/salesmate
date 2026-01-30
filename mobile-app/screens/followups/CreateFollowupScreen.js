import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import followupService from '../../services/followupService';

const CreateFollowupScreen = ({ navigation, route }) => {
  const customer = route.params?.customer;
  
  const [phone, setPhone] = useState(customer?.phone || '');
  const [followUpAt, setFollowUpAt] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [followUpNote, setFollowUpNote] = useState('');
  const [followUpType, setFollowUpType] = useState('call');
  const [followUpPriority, setFollowUpPriority] = useState('medium');
  const [saving, setSaving] = useState(false);

  const types = [
    { value: 'call', label: 'Call', icon: 'phone' },
    { value: 'visit', label: 'Visit', icon: 'map-marker' },
    { value: 'message', label: 'Message', icon: 'message-text' },
    { value: 'email', label: 'Email', icon: 'email' }
  ];

  const priorities = [
    { value: 'low', label: 'Low', color: '#10b981' },
    { value: 'medium', label: 'Medium', color: '#3b82f6' },
    { value: 'high', label: 'High', color: '#f59e0b' },
    { value: 'urgent', label: 'Urgent', color: '#dc2626' }
  ];

  const handleDateChange = (event, selectedDate) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      const newDate = new Date(followUpAt);
      newDate.setFullYear(selectedDate.getFullYear());
      newDate.setMonth(selectedDate.getMonth());
      newDate.setDate(selectedDate.getDate());
      setFollowUpAt(newDate);
    }
  };

  const handleTimeChange = (event, selectedTime) => {
    setShowTimePicker(Platform.OS === 'ios');
    if (selectedTime) {
      const newDate = new Date(followUpAt);
      newDate.setHours(selectedTime.getHours());
      newDate.setMinutes(selectedTime.getMinutes());
      setFollowUpAt(newDate);
    }
  };

  const handleSave = async () => {
    if (!phone.trim()) {
      Alert.alert('Error', 'Please enter customer phone number');
      return;
    }

    if (!followUpNote.trim()) {
      Alert.alert('Error', 'Please enter a follow-up note');
      return;
    }

    try {
      setSaving(true);
      await followupService.createFollowup({
        phone: phone.trim(),
        followUpAt: followUpAt.toISOString(),
        followUpNote: followUpNote.trim(),
        followUpType,
        followUpPriority
      });

      Alert.alert('Success', 'Follow-up created successfully', [
        {
          text: 'OK',
          onPress: () => navigation.goBack()
        }
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to create follow-up: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color="#1f2937" />
        </TouchableOpacity>
        <Text style={styles.title}>Create Follow-up</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        {/* Phone Input */}
        <View style={styles.section}>
          <Text style={styles.label}>Customer Phone *</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Enter phone number"
            keyboardType="phone-pad"
            editable={!customer}
          />
        </View>

        {/* Date & Time */}
        <View style={styles.section}>
          <Text style={styles.label}>Follow-up Date & Time *</Text>
          <View style={styles.dateTimeRow}>
            <TouchableOpacity
              style={[styles.dateTimeButton, { flex: 2 }]}
              onPress={() => setShowDatePicker(true)}
            >
              <Icon name="calendar" size={20} color="#6b7280" />
              <Text style={styles.dateTimeText}>{formatDate(followUpAt)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dateTimeButton, { flex: 1 }]}
              onPress={() => setShowTimePicker(true)}
            >
              <Icon name="clock-outline" size={20} color="#6b7280" />
              <Text style={styles.dateTimeText}>{formatTime(followUpAt)}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={followUpAt}
            mode="date"
            display="default"
            onChange={handleDateChange}
            minimumDate={new Date()}
          />
        )}

        {showTimePicker && (
          <DateTimePicker
            value={followUpAt}
            mode="time"
            display="default"
            onChange={handleTimeChange}
          />
        )}

        {/* Type */}
        <View style={styles.section}>
          <Text style={styles.label}>Follow-up Type *</Text>
          <View style={styles.optionsRow}>
            {types.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.optionButton,
                  followUpType === type.value && styles.optionButtonActive
                ]}
                onPress={() => setFollowUpType(type.value)}
              >
                <Icon
                  name={type.icon}
                  size={20}
                  color={followUpType === type.value ? '#3b82f6' : '#6b7280'}
                />
                <Text style={[
                  styles.optionText,
                  followUpType === type.value && styles.optionTextActive
                ]}>
                  {type.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Priority */}
        <View style={styles.section}>
          <Text style={styles.label}>Priority *</Text>
          <View style={styles.optionsRow}>
            {priorities.map((priority) => (
              <TouchableOpacity
                key={priority.value}
                style={[
                  styles.priorityButton,
                  followUpPriority === priority.value && {
                    backgroundColor: priority.color + '20',
                    borderColor: priority.color
                  }
                ]}
                onPress={() => setFollowUpPriority(priority.value)}
              >
                <Text style={[
                  styles.priorityText,
                  followUpPriority === priority.value && { color: priority.color }
                ]}>
                  {priority.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Note */}
        <View style={styles.section}>
          <Text style={styles.label}>Notes *</Text>
          <TextInput
            style={styles.textArea}
            value={followUpNote}
            onChangeText={setFollowUpNote}
            placeholder="Enter follow-up notes, reminders, or context..."
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>
      </ScrollView>

      {/* Save Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? 'Creating...' : 'Create Follow-up'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb'
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937'
  },
  content: {
    flex: 1,
    padding: 16
  },
  section: {
    marginBottom: 24
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1f2937'
  },
  textArea: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1f2937',
    minHeight: 100
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 8
  },
  dateTimeButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  dateTimeText: {
    fontSize: 14,
    color: '#1f2937',
    flex: 1
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  optionButton: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  optionButtonActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#3b82f6',
    borderWidth: 2
  },
  optionText: {
    fontSize: 14,
    color: '#6b7280'
  },
  optionTextActive: {
    color: '#3b82f6',
    fontWeight: '600'
  },
  priorityButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center'
  },
  priorityText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500'
  },
  footer: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb'
  },
  saveButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center'
  },
  saveButtonDisabled: {
    opacity: 0.6
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff'
  }
});

export default CreateFollowupScreen;
