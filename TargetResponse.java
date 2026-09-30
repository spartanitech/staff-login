package com.spartan.attendance.dto;

import com.spartan.attendance.entity.SalesTarget;
import com.spartan.attendance.entity.User;

public record TargetResponse(Long officerId, String officerName, String month, long amount, String setByName) {

    public static TargetResponse from(SalesTarget t) {
        User by = t.getSetBy();
        return new TargetResponse(t.getOfficer().getId(), t.getOfficer().getName(), t.getMonth(), t.getAmount(),
                by == null ? null : by.getName());
    }
}
