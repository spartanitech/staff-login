package com.spartan.attendance.dto;

import com.spartan.attendance.entity.Attendance;
import com.spartan.attendance.entity.AttendanceStatus;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Shop;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.entity.WorkLocation;
import com.spartan.attendance.util.AttendanceRules;
import java.time.LocalDate;
import java.time.LocalDateTime;

public record AttendanceResponse(
        Long id, Long userId, String employeeCode, String employeeName, Role role,
        LocalDate attendanceDate, LocalDateTime checkInTime, LocalDateTime checkOutTime,
        Double checkInLatitude, Double checkInLongitude, Double checkOutLatitude, Double checkOutLongitude,
        Double checkInAccuracy, Double checkOutAccuracy,
        Double checkInDistanceMeters, Double checkOutDistanceMeters,
        Integer totalWorkingMinutes, String workingHours, AttendanceStatus status,
        Long workLocationId, String workLocationName, Integer allowedRadiusMeters,
        Long shopId, String shopCode, String shopName, boolean hasPhoto,
        String deviceInfo, String ipAddress,
        String correctionReason, LocalDateTime correctedAt) {

    /** @param technical include device/IP details - only ever true for ADMIN callers. */
    public static AttendanceResponse from(Attendance a, boolean technical) {
        User u = a.getUser();
        WorkLocation w = a.getWorkLocation();
        Shop sh = a.getShop();
        return new AttendanceResponse(
                a.getId(), u.getId(), u.getEmployeeCode(), u.getName(), u.getRole(),
                a.getAttendanceDate(), a.getCheckInTime(), a.getCheckOutTime(),
                a.getCheckInLatitude(), a.getCheckInLongitude(), a.getCheckOutLatitude(), a.getCheckOutLongitude(),
                a.getCheckInAccuracy(), a.getCheckOutAccuracy(),
                a.getCheckInDistanceMeters(), a.getCheckOutDistanceMeters(),
                a.getTotalWorkingMinutes(),
                a.getCheckOutTime() == null ? null : AttendanceRules.formatMinutes(a.getTotalWorkingMinutes()),
                a.getStatus(),
                w == null ? null : w.getId(), w == null ? null : w.getName(),
                w != null ? Integer.valueOf(w.getAllowedRadiusMeters()) : (sh == null ? null : Integer.valueOf(sh.getAllowedRadiusMeters())),
                sh == null ? null : sh.getId(), sh == null ? null : sh.getCode(), sh == null ? null : sh.getName(),
                a.getCheckInPhoto() != null,
                technical ? a.getDeviceInfo() : null, technical ? a.getIpAddress() : null,
                a.getCorrectionReason(), a.getCorrectedAt());
    }
}
