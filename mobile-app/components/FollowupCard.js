import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import moment from 'moment';

const FollowupCard = ({ followup, onPress, onComplete, onDelete }) => {
  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return '#dc2626';
      case 'high': return '#f59e0b';
      case 'medium': return '#3b82f6';
      case 'low': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'call': return 'phone';
      case 'visit': return 'map-marker';
      case 'message': return 'message-text';
      case 'email': return 'email';
      default: return 'calendar';
    }
  };

  const formatDate = (dateStr) => {
    const date = moment(dateStr);
    const now = moment();
    
    if (date.isSame(now, 'day')) {
      return date.format('h:mm A');
    } else if (date.isSame(now.clone().add(1, 'day'), 'day')) {
      return 'Tomorrow ' + date.format('h:mm A');
    } else if (date.isSame(now.clone().subtract(1, 'day'), 'day')) {
      return 'Yesterday ' + date.format('h:mm A');
    } else {
      return date.format('MMM D, h:mm A');
    }
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      {/* Priority Indicator */}
      <View style={[styles.priorityBar, { backgroundColor: getPriorityColor(followup.followUpPriority) }]} />

      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.customerInfo}>
            <Text style={styles.customerName} numberOfLines={1}>
              {followup.customerName}
            </Text>
            {followup.city && (
              <Text style={styles.city}>{followup.city}</Text>
            )}
          </View>
          <View style={[styles.typeIcon, { backgroundColor: getPriorityColor(followup.followUpPriority) + '20' }]}>
            <Icon 
              name={getTypeIcon(followup.followUpType)} 
              size={20} 
              color={getPriorityColor(followup.followUpPriority)} 
            />
          </View>
        </View>

        {/* Time */}
        <View style={styles.timeRow}>
          <Icon name="clock-outline" size={16} color="#6b7280" />
          <Text style={[
            styles.time,
            followup.isOverdue && styles.overdueText
          ]}>
            {formatDate(followup.followUpAt)}
          </Text>
          {followup.isOverdue && (
            <View style={styles.overdueBadge}>
              <Text style={styles.overdueLabel}>OVERDUE</Text>
            </View>
          )}
        </View>

        {/* Note */}
        {followup.followUpNote && (
          <Text style={styles.note} numberOfLines={2}>
            {followup.followUpNote}
          </Text>
        )}

        {/* Customer Details */}
        <View style={styles.details}>
          <View style={styles.detailItem}>
            <Icon name="phone" size={14} color="#9ca3af" />
            <Text style={styles.detailText}>{followup.phone}</Text>
          </View>
          {followup.customerType && (
            <View style={styles.detailItem}>
              <Icon name="tag" size={14} color="#9ca3af" />
              <Text style={styles.detailText}>{followup.customerType}</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        {!followup.completedAt && (
          <View style={styles.actions}>
            <TouchableOpacity 
              style={[styles.actionButton, styles.completeButton]}
              onPress={onComplete}
            >
              <Icon name="check-circle" size={18} color="#10b981" />
              <Text style={[styles.actionText, styles.completeText]}>Complete</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.actionButton, styles.deleteButton]}
              onPress={onDelete}
            >
              <Icon name="close-circle" size={18} color="#ef4444" />
              <Text style={[styles.actionText, styles.deleteText]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2
  },
  priorityBar: {
    width: 4,
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0
  },
  content: {
    padding: 16,
    paddingLeft: 20
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  customerInfo: {
    flex: 1,
    marginRight: 12
  },
  customerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 2
  },
  city: {
    fontSize: 12,
    color: '#6b7280'
  },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center'
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8
  },
  time: {
    fontSize: 14,
    color: '#6b7280',
    marginLeft: 6,
    flex: 1
  },
  overdueText: {
    color: '#dc2626',
    fontWeight: '600'
  },
  overdueBadge: {
    backgroundColor: '#fef2f2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#fecaca'
  },
  overdueLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#dc2626'
  },
  note: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 12,
    lineHeight: 20
  },
  details: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    marginBottom: 4
  },
  detailText: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 4
  },
  actions: {
    flexDirection: 'row',
    gap: 8
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1
  },
  completeButton: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac'
  },
  deleteButton: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca'
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4
  },
  completeText: {
    color: '#10b981'
  },
  deleteText: {
    color: '#ef4444'
  }
});

export default FollowupCard;
