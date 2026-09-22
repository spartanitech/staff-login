package com.spartan.attendance.service;

import com.spartan.attendance.dto.StatusRequest;
import com.spartan.attendance.dto.WorkLocationRequest;
import com.spartan.attendance.dto.WorkLocationResponse;
import com.spartan.attendance.entity.AuditAction;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.WorkLocation;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.WorkLocationRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.RequestInfo;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class WorkLocationService {

    private final WorkLocationRepository repository;
    private final AuditService auditService;

    @Transactional(readOnly = true)
    public List<WorkLocationResponse> list(boolean includeInactive) {
        List<WorkLocation> all = includeInactive ? repository.findAllByOrderByNameAsc()
                : repository.findByStatusOrderByNameAsc(Status.ACTIVE);
        return all.stream().map(WorkLocationResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public WorkLocationResponse get(Long id) {
        return WorkLocationResponse.from(find(id));
    }

    @Transactional
    public WorkLocationResponse create(AppUserDetails admin, WorkLocationRequest req, RequestInfo info) {
        if (repository.existsByNameIgnoreCase(req.name().trim())) {
            throw ApiException.conflict("LOCATION_NAME_TAKEN", "A work location with that name already exists.");
        }
        WorkLocation w = repository.save(WorkLocation.builder()
                .name(req.name().trim())
                .address(req.address() == null || req.address().isBlank() ? null : req.address().trim())
                .latitude(req.latitude())
                .longitude(req.longitude())
                .allowedRadiusMeters(req.allowedRadiusMeters())
                .status(req.status() == null ? Status.ACTIVE : req.status())
                .build());
        auditService.log(admin.getId(), AuditAction.WORK_LOCATION_CREATE,
                "Created work location '" + w.getName() + "' radius " + w.getAllowedRadiusMeters() + " m", info);
        return WorkLocationResponse.from(w);
    }

    @Transactional
    public WorkLocationResponse update(AppUserDetails admin, Long id, WorkLocationRequest req, RequestInfo info) {
        WorkLocation w = find(id);
        String newName = req.name().trim();
        if (!newName.equalsIgnoreCase(w.getName()) && repository.existsByNameIgnoreCase(newName)) {
            throw ApiException.conflict("LOCATION_NAME_TAKEN", "A work location with that name already exists.");
        }
        w.setName(newName);
        w.setAddress(req.address() == null || req.address().isBlank() ? null : req.address().trim());
        w.setLatitude(req.latitude());
        w.setLongitude(req.longitude());
        w.setAllowedRadiusMeters(req.allowedRadiusMeters());
        if (req.status() != null) {
            w.setStatus(req.status());
        }
        w = repository.save(w);
        auditService.log(admin.getId(), AuditAction.WORK_LOCATION_UPDATE,
                "Updated work location '" + w.getName() + "' radius " + w.getAllowedRadiusMeters() + " m", info);
        return WorkLocationResponse.from(w);
    }

    @Transactional
    public WorkLocationResponse setStatus(AppUserDetails admin, Long id, StatusRequest req, RequestInfo info) {
        WorkLocation w = find(id);
        w.setStatus(req.status());
        w = repository.save(w);
        auditService.log(admin.getId(), AuditAction.WORK_LOCATION_STATUS_CHANGE,
                "Work location '" + w.getName() + "' is now " + w.getStatus(), info);
        return WorkLocationResponse.from(w);
    }

    private WorkLocation find(Long id) {
        return repository.findById(id).orElseThrow(() -> ApiException.notFound("Work location not found."));
    }
}
