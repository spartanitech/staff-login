package com.spartan.attendance.dto;

import com.spartan.attendance.entity.Role;
import java.time.LocalDate;
import java.util.List;

public record SummaryResponse(LocalDate from, LocalDate to, int totalWorkingDays, int present, int absent, int late,
                              int halfDay, long totalWorkingMinutes, String totalWorkingHours,
                              List<EmployeeSummary> employees) {

    public record EmployeeSummary(Long userId, String employeeCode, String name, Role role, int workingDays,
                                  int present, int absent, int late, int halfDay, long totalWorkingMinutes,
                                  String totalWorkingHours) {
    }
}
