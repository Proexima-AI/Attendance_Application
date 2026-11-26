import React, { createContext, useState, useRef, ReactNode, useEffect } from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, Dimensions, Alert, ActivityIndicator, Image } from 'react-native';
import { Text } from '../components/Themed';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { attendanceService } from '../services/attendanceService';
import { useAuth } from '../hooks/useAuth';
import {
  formatAttendanceLocation,
  getCurrentLocationLabel,
  getTodayDateKey,
  reverseGeocodeCoords,
} from '../utils/locationHelper';

const { height } = Dimensions.get('window');

type CheckInContextType = {
  punchInTime: Date | null;
  punchOutTime: Date | null;
  attendanceStatus: string | null;
  capturedPhoto: string | null;
  isCameraModalVisible: boolean;
  openCheckIn: () => void;
  closeCheckIn: () => void;
  setPunchInTime: (date: Date | null) => void;
  fetchStatus: () => Promise<void>;
  selectedLocationType: string | null;
  isCheckedIn: boolean;
  isCheckedOut: boolean;
  currentLocationLabel: string | null;
  todayCheckInLocation: string | null;
};

export const CheckInContext = createContext<CheckInContextType>({
  punchInTime: null,
  punchOutTime: null,
  attendanceStatus: null,
  capturedPhoto: null,
  isCameraModalVisible: false,
  openCheckIn: () => {},
  closeCheckIn: () => {},
  setPunchInTime: () => {},
  fetchStatus: async () => {},
  selectedLocationType: null,
  isCheckedIn: false,
  isCheckedOut: false,
  currentLocationLabel: null,
  todayCheckInLocation: null,
});

export const CheckInProvider = ({ children }: { children: ReactNode }) => {
  const [punchInTime, setPunchInTime] = useState<Date | null>(null);
  const [punchOutTime, setPunchOutTime] = useState<Date | null>(null);
  const [attendanceStatus, setAttendanceStatus] = useState<string | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [capturedPhotoBase64, setCapturedPhotoBase64] = useState<string | null>(null);
  const [isCameraModalVisible, setIsCameraModalVisible] = useState(false);
  const [isLocationSheetVisible, setIsLocationSheetVisible] = useState(false);
  const [selectedLocationType, setSelectedLocationType] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [isCheckedOut, setIsCheckedOut] = useState(false);
  const [currentLocationLabel, setCurrentLocationLabel] = useState<string | null>(null);
  const [todayCheckInLocation, setTodayCheckInLocation] = useState<string | null>(null);
  const [statusModal, setStatusModal] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
  }>({
    visible: false,
    type: 'info',
    title: '',
    message: '',
  });
  const { user } = useAuth();

  const showStatusModal = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    setStatusModal({ visible: true, type, title, message });
  };

  const closeStatusModal = () => {
    setStatusModal(prev => ({ ...prev, visible: false }));
  };

  const fetchStatus = async () => {
    try {
      const [response, liveLabel] = await Promise.all([
        attendanceService.getStatus(),
        getCurrentLocationLabel(),
      ]);

      if (liveLabel) {
        setCurrentLocationLabel(liveLabel);
      }

      const todayKey = `checkin_location_${getTodayDateKey()}`;
      const cachedLocation = await AsyncStorage.getItem(todayKey);

      if (response.success && response.data) {
        setIsCheckedOut(response.data.checked_out);
        setIsCheckedIn(response.data.checked_in && !response.data.checked_out);
        if (response.data.record) {
          const rec = response.data.record;
          if (rec.checkin_time) {
            setPunchInTime(new Date(rec.checkin_time));
          }
          if (rec.checkout_time) {
            setPunchOutTime(new Date(rec.checkout_time));
          }
          if (rec.status) {
            setAttendanceStatus(rec.status);
          }

          // Resolve today's check-in location from backend record or cached location
          const backendLoc = rec.address || rec.location;
          if (backendLoc) {
            const formatted = rec.attendance_type
              ? formatAttendanceLocation(rec.attendance_type, backendLoc)
              : backendLoc;
            setTodayCheckInLocation(formatted);
            await AsyncStorage.setItem(todayKey, formatted);
          } else if (rec.latitude != null && rec.longitude != null) {
            const place = await reverseGeocodeCoords(Number(rec.latitude), Number(rec.longitude));
            const formatted = formatAttendanceLocation(rec.attendance_type, place || liveLabel);
            setTodayCheckInLocation(formatted);
            await AsyncStorage.setItem(todayKey, formatted);
          } else if (cachedLocation) {
            setTodayCheckInLocation(cachedLocation);
          } else if (rec.checkin_time && (rec.attendance_type || liveLabel)) {
            setTodayCheckInLocation(formatAttendanceLocation(rec.attendance_type, liveLabel));
          }
        } else if (cachedLocation) {
          setTodayCheckInLocation(cachedLocation);
        }
      }
    } catch (e) {
      // Intentionally swallow the log if it's a known non-fatal token issue to avoid cluttering the console
      if (e instanceof Error && e.message === 'No refresh token available locally') {
        // user is logged out, no action needed
      } else {
        console.log('Failed to fetch attendance status', e);
      }
    }
  };

  useEffect(() => {
    // Only attempt to fetch attendance if the user exists (is logged in)
    if (user) {
      fetchStatus();
    } else {
      // Reset state if user logs out
      setIsCheckedIn(false);
      setIsCheckedOut(false);
      setPunchInTime(null);
      setPunchOutTime(null);
      setAttendanceStatus(null);
    }
  }, [user]);
  
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const openCheckIn = async () => {
    if (isCheckedOut) {
      showStatusModal("info", "Notice", "Attendance was already recorded for today");
      return;
    }

    if (isCheckedIn) {
      // User is checking out - skip location selection sheet
      if (!permission?.granted) {
        await requestPermission();
      }
      setIsCameraModalVisible(true);
    } else {
      setIsLocationSheetVisible(true);
    }
  };

  const handleLocationSelect = async (location: string) => {
    setSelectedLocationType(location);
    setIsLocationSheetVisible(false);
    
    if (!permission?.granted) {
      await requestPermission();
    }
    
    // Brief delay to allow bottom sheet animation to finish before opening camera modal
    setTimeout(() => {
      setIsCameraModalVisible(true);
    }, 300);
  };

  const closeCheckIn = () => {
    setIsCameraModalVisible(false);
    setIsLocationSheetVisible(false);
    setCapturedPhoto(null);
    setCapturedPhotoBase64(null);
    setIsSubmitting(false);
  };

  const takePicture = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync({ base64: true });
      if (photo) {
        setCapturedPhoto(photo.uri);
        setCapturedPhotoBase64(photo.base64 || null);
      }
    }
  };

  const handlePunchIn = async () => {
    try {
      setIsSubmitting(true);

      // 1. Get Location
      let latitude = null;
      let longitude = null;
      
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (selectedLocationType === 'Office') {
          showStatusModal("error", "Permission Denied", "Location permission is required for Office.");
          setIsSubmitting(false);
          return;
        }
      } else {
        const location = await Location.getCurrentPositionAsync({});
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
      }

      if (isCheckedIn) {
        // Check-out flow
        try {
          const response = await attendanceService.checkOut({ latitude, longitude });
          await fetchStatus(); // Fetch status to update UI instantly
          closeCheckIn();
          showStatusModal("success", "Success", response.message || "Checked out successfully");
        } catch (error: any) {
          if (error?.requires_confirmation) {
            Alert.alert(
              "Confirmation Required",
              error.message || "Do you want to proceed?",
              [
                {
                  text: "No",
                  onPress: () => setIsSubmitting(false),
                  style: "cancel"
                },
                {
                  text: "Yes",
                  onPress: async () => {
                    try {
                      const outOfBoundsResponse = await attendanceService.checkOutOutOfBounds({
                        latitude,
                        longitude,
                        reason: "Out of bounds checkout"
                      });
                      await fetchStatus(); // Fetch status to update UI instantly
                      closeCheckIn();
                      showStatusModal("success", "Success", outOfBoundsResponse.message || "Out-of-bounds check-out requested successfully and is pending approval.");
                    } catch (innerError: any) {
                      setIsSubmitting(false);
                      showStatusModal("error", "Check-out Failed", innerError?.message || "Failed to submit out-of-bounds check-out.");
                    }
                  }
                }
              ]
            );
            return; // Wait for user action
          } else {
            setIsSubmitting(false);
            showStatusModal("error", "Check-out Failed", error?.message || "Failed to check out. Please try again.");
          }
        }
      } else {
        // Check-in flow
        let type: 'office' | 'wfh' | 'outdoor' = 'office';
        if (selectedLocationType === 'Work from home') type = 'wfh';
        if (selectedLocationType === 'Outdoor duty') type = 'outdoor';

        const response = await attendanceService.checkIn({
          latitude,
          longitude,
          attendance_type: type,
          selfie_data: capturedPhotoBase64 ? `data:image/jpeg;base64,${capturedPhotoBase64}` : null
        });

        // Reverse-geocode and persist today's check-in location
        const placeLabel =
          latitude != null && longitude != null
            ? await reverseGeocodeCoords(latitude, longitude)
            : currentLocationLabel;
        const formattedCheckInLoc = formatAttendanceLocation(selectedLocationType, placeLabel);
        setTodayCheckInLocation(formattedCheckInLoc);
        if (placeLabel) setCurrentLocationLabel(placeLabel);
        await AsyncStorage.setItem(`checkin_location_${getTodayDateKey()}`, formattedCheckInLoc);

        await fetchStatus(); // Fetch status to update UI instantly
        closeCheckIn();
        
        let alertMsg = response.message || "Checked in successfully";
        if (response.data?.warning) {
          alertMsg += `\n\nNote: ${response.data.warning}`;
        }
        showStatusModal("success", "Success", alertMsg);
      }
    } catch (error: any) {
      setIsSubmitting(false);
      const errorMsg = error?.message || "Failed to submit request. Please try again.";
      showStatusModal("error", "Error", errorMsg);
    }
  };

  return (
    <CheckInContext.Provider value={{ punchInTime, punchOutTime, attendanceStatus, capturedPhoto, isCameraModalVisible, openCheckIn, closeCheckIn, setPunchInTime, fetchStatus, selectedLocationType, isCheckedIn, isCheckedOut, currentLocationLabel, todayCheckInLocation }}>
      {children}

      {/* Location Selection Bottom Sheet */}
      <Modal visible={isLocationSheetVisible} animationType="slide" transparent={true} onRequestClose={closeCheckIn}>
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={closeCheckIn}>
          <TouchableOpacity activeOpacity={1} style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              Where are you checking in from?
            </Text>
            
            <TouchableOpacity style={styles.sheetOption} onPress={() => handleLocationSelect('Office')}>
              <MaterialCommunityIcons name="office-building-outline" size={24} color={COLORS.text} style={styles.sheetIcon} />
              <Text style={styles.sheetOptionText}>Office</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.sheetOption} onPress={() => handleLocationSelect('Work from home')}>
              <Ionicons name="home-outline" size={24} color={COLORS.text} style={styles.sheetIcon} />
              <Text style={styles.sheetOptionText}>Work from home</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetOption} onPress={() => handleLocationSelect('Outdoor duty')}>
              <Ionicons name="location-outline" size={24} color={COLORS.text} style={styles.sheetIcon} />
              <Text style={styles.sheetOptionText}>Outdoor duty</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Global Camera Modal */}
      <Modal visible={isCameraModalVisible} animationType="slide" transparent={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {isCheckedIn ? "Check Out Photo" : "Check In Photo"}
            </Text>
            <TouchableOpacity onPress={closeCheckIn} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.cameraContainer}>
            {capturedPhoto ? (
              <Image
                source={{ uri: capturedPhoto }}
                style={styles.camera}
                resizeMode="cover"
              />
            ) : permission?.granted ? (
              <>
                <CameraView 
                  ref={cameraRef}
                  style={styles.camera} 
                  facing="front"
                />
                <View style={styles.cameraOverlay}>
                  <View style={styles.faceOutline} />
                </View>
              </>
            ) : (
              <View style={styles.noPermissionContainer}>
                <Text style={{textAlign: 'center', color: COLORS.textMuted}}>We need your permission to show the camera</Text>
                <TouchableOpacity onPress={requestPermission} style={{marginTop: 20}}>
                  <Text style={{color: COLORS.primary, fontWeight: 'bold'}}>Grant Permission</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.modalFooter}>
            <TouchableOpacity 
              style={[styles.captureButton, capturedPhoto && styles.capturedButton, isSubmitting && { opacity: 0.7 }]} 
              onPress={isSubmitting ? undefined : (capturedPhoto ? handlePunchIn : takePicture)}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.captureButtonText}>
                  {capturedPhoto ? (isCheckedIn ? 'Confirm Check Out' : 'Confirm Check In') : 'Take Photo'}
                </Text>
              )}
            </TouchableOpacity>
            {capturedPhoto && !isSubmitting && (
              <TouchableOpacity
                style={styles.retakeButton}
                onPress={() => {
                  setCapturedPhoto(null);
                  setCapturedPhotoBase64(null);
                }}
              >
                <Text style={styles.retakeButtonText}>Retake Photo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Customized Status Modal */}
      <Modal
        visible={statusModal.visible}
        animationType="fade"
        transparent={true}
        onRequestClose={closeStatusModal}
      >
        <View style={styles.statusModalOverlay}>
          <View style={styles.statusModalCard}>
            <View
              style={[
                styles.statusModalIconContainer,
                statusModal.type === 'success'
                  ? { backgroundColor: '#DCFCE7' }
                  : statusModal.type === 'error'
                  ? { backgroundColor: '#FEE2E2' }
                  : { backgroundColor: '#EDE9FE' },
              ]}
            >
              <Ionicons
                name={
                  statusModal.type === 'success'
                    ? 'checkmark-circle'
                    : statusModal.type === 'error'
                    ? 'alert-circle'
                    : 'information-circle'
                }
                size={40}
                color={
                  statusModal.type === 'success'
                    ? COLORS.statusPresent
                    : statusModal.type === 'error'
                    ? COLORS.danger
                    : COLORS.primary
                }
              />
            </View>
            <Text style={styles.statusModalTitle}>{statusModal.title}</Text>
            <Text style={styles.statusModalMessage}>{statusModal.message}</Text>
            <TouchableOpacity
              style={[
                styles.statusModalButton,
                statusModal.type === 'success'
                  ? { backgroundColor: COLORS.statusPresent }
                  : statusModal.type === 'error'
                  ? { backgroundColor: COLORS.danger }
                  : { backgroundColor: COLORS.primary },
              ]}
              onPress={closeStatusModal}
            >
              <Text style={styles.statusModalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </CheckInContext.Provider>
  );
};

const styles = StyleSheet.create({
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheetContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#D1D5DB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 20,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sheetIcon: {
    marginRight: 12,
  },
  sheetOptionText: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '500',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#FFFFFF',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  closeButton: {
    padding: 8,
    backgroundColor: COLORS.pageBgTint,
    borderRadius: 20,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
    margin: 20,
    borderRadius: 20,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceOutline: {
    width: 250,
    height: 350,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 125,
    borderStyle: 'dashed',
  },
  noPermissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  modalFooter: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: '#FFFFFF',
  },
  captureButton: {
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  capturedButton: {
    backgroundColor: COLORS.statusPresent,
  },
  captureButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  retakeButton: {
    marginTop: 12,
    padding: 12,
    alignItems: 'center',
  },
  retakeButtonText: {
    color: COLORS.textMuted,
    fontSize: 15,
    fontWeight: '600',
  },
  statusModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  statusModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  statusModalIconContainer: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  statusModalMessage: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  statusModalButton: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusModalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
