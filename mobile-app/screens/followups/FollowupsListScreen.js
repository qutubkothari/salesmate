import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import followupService from '../../services/followupService';
import FollowupCard from '../../components/FollowupCard';

const FollowupsListScreen = ({ navigation }) => {
  const [followups, setFollowups] = useState([]);
  const [categorized, setCategorized] = useState({});
  const [counts, setCounts] = useState({});
  const [selectedTab, setSelectedTab] = useState('overdue'); // overdue, today, upcoming, completed
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadFollowups();
  }, []);

  const loadFollowups = async () => {
    try {
      setLoading(true);
      const response = await followupService.getFollowups('pending', 100);
      setFollowups(response.followups || []);
      setCategorized(response.categorized || {});
      setCounts(response.counts || {});
    } catch (error) {
      Alert.alert('Error', 'Failed to load followups: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadFollowups();
    setRefreshing(false);
  };

  const handleCompleteFollowup = async (followup) => {
    Alert.alert(
      'Complete Follow-up',
      'Mark this follow-up as completed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete',
          onPress: async () => {
            try {
              await followupService.completeFollowup(followup.id);
              Alert.alert('Success', 'Follow-up marked as complete');
              loadFollowups();
            } catch (error) {
              Alert.alert('Error', 'Failed to complete followup: ' + error.message);
            }
          }
        }
      ]
    );
  };

  const handleDeleteFollowup = async (followup) => {
    Alert.alert(
      'Cancel Follow-up',
      'Are you sure you want to cancel this follow-up?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: async () => {
            try {
              await followupService.deleteFollowup(followup.id);
              Alert.alert('Success', 'Follow-up cancelled');
              loadFollowups();
            } catch (error) {
              Alert.alert('Error', 'Failed to cancel followup: ' + error.message);
            }
          }
        }
      ]
    );
  };

  const getCurrentList = () => {
    return categorized[selectedTab] || [];
  };

  const renderTabButton = (tab, label, count, color) => (
    <TouchableOpacity
      style={[
        styles.tabButton,
        selectedTab === tab && styles.tabButtonActive,
        { borderBottomColor: color }
      ]}
      onPress={() => setSelectedTab(tab)}
    >
      <Text style={[
        styles.tabLabel,
        selectedTab === tab && styles.tabLabelActive
      ]}>
        {label}
      </Text>
      <View style={[styles.badge, { backgroundColor: color }]}>
        <Text style={styles.badgeText}>{count || 0}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderFollowup = ({ item }) => (
    <FollowupCard
      followup={item}
      onPress={() => navigation.navigate('FollowupDetail', { followup: item })}
      onComplete={() => handleCompleteFollowup(item)}
      onDelete={() => handleDeleteFollowup(item)}
    />
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Follow-ups</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('CreateFollowup')}
        >
          <Icon name="plus" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {renderTabButton('overdue', 'Overdue', counts.overdue, '#ef4444')}
        {renderTabButton('today', 'Today', counts.today, '#f59e0b')}
        {renderTabButton('upcoming', 'Upcoming', counts.upcoming, '#3b82f6')}
        {renderTabButton('completed', 'Completed', counts.completed, '#10b981')}
      </View>

      {/* List */}
      <FlatList
        data={getCurrentList()}
        keyExtractor={(item) => item.id}
        renderItem={renderFollowup}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="calendar-check" size={64} color="#d1d5db" />
            <Text style={styles.emptyText}>No {selectedTab} follow-ups</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb'
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
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
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937'
  },
  addButton: {
    backgroundColor: '#3b82f6',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center'
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb'
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent'
  },
  tabButtonActive: {
    borderBottomWidth: 3
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4
  },
  tabLabelActive: {
    color: '#1f2937'
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center'
  },
  badgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#fff'
  },
  list: {
    padding: 16
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#9ca3af'
  }
});

export default FollowupsListScreen;
