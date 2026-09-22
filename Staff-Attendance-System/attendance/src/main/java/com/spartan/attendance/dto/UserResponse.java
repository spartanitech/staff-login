package com.spartan.attendance.dto;

import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;
import java.time.LocalDateTime;

public record UserResponse(Long id, String employeeCode, String name, String username, String email, String phone,
                           Role role, String designation, String area, String region, Status status,
                           Long reportingManagerId, String reportingManagerName,
                           LocalDateTime createdAt, LocalDateTime updatedAt) {

    public static UserResponse from(User u) {
        User m = u.getReportingManager();
        return new UserResponse(u.getId(), u.getEmployeeCode(), u.getName(), u.getUsername(), u.getEmail(), u.getPhone(),
                u.getRole(), u.getDesignation(), u.getArea(), u.getRegion(), u.getStatus(),
                m == null ? null : m.getId(), m == null ? null : m.getName(),
                u.getCreatedAt(), u.getUpdatedAt());
    }
}
