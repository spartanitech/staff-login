package com.spartan.attendance.service;

import com.spartan.attendance.config.AppProperties;
import com.spartan.attendance.dto.ShopRequest;
import com.spartan.attendance.dto.ShopResponse;
import com.spartan.attendance.dto.StatusRequest;
import com.spartan.attendance.entity.AuditAction;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Shop;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.AttendanceRepository;
import com.spartan.attendance.repository.ShopRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.RequestInfo;
import jakarta.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Shops a Sales Officer can mark attendance at. Only the Admin creates, moves, assigns or deactivates them. */
@Service
@RequiredArgsConstructor
public class ShopService {

    private final ShopRepository repository;
    private final UserRepository userRepository;
    private final AttendanceRepository attendanceRepository;
    private final AuditService auditService;
    private final AppProperties props;

    @Transactional(readOnly = true)
    public List<ShopResponse> list(boolean includeInactive, Long officerId) {
        Specification<Shop> spec = (root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
            if (!includeInactive) {
                p.add(cb.equal(root.get("status"), Status.ACTIVE));
            }
            if (officerId != null) {
                p.add(cb.equal(root.get("assignedOfficer").get("id"), officerId));
            }
            return cb.and(p.toArray(new Predicate[0]));
        };
        return repository.findAll(spec, Sort.by("name")).stream().map(ShopResponse::from).toList();
    }

    /** The active shops assigned to the signed-in Sales Officer - the only shops they may check in at. */
    @Transactional(readOnly = true)
    public List<ShopResponse> mine(AppUserDetails caller) {
        return repository.findByAssignedOfficerIdAndStatusOrderByNameAsc(caller.getId(), Status.ACTIVE)
                .stream().map(ShopResponse::from).toList();
    }

    @Transactional
    public ShopResponse create(AppUserDetails admin, ShopRequest req, RequestInfo info) {
        String code = blank(req.code()) ? nextCode() : req.code().trim().toUpperCase(Locale.ROOT);
        if (repository.existsByCodeIgnoreCase(code)) {
            throw ApiException.conflict("SHOP_CODE_TAKEN", "A shop with the code " + code + " already exists.");
        }
        User officer = resolveOfficer(req.assignedOfficerId());
        Shop s = repository.save(Shop.builder()
                .code(code)
                .name(req.name().trim())
                .locality(clean(req.locality()))
                .region(clean(req.region()))
                .address(clean(req.address()))
                .phone(clean(req.phone()))
                .latitude(req.latitude())
                .longitude(req.longitude())
                .allowedRadiusMeters(radius(req))
                .assignedOfficer(officer)
                .status(req.status() == null ? Status.ACTIVE : req.status())
                .build());
        auditService.log(admin.getId(), AuditAction.SHOP_CREATE,
                "Created shop " + s.getCode() + " '" + s.getName() + "' radius " + s.getAllowedRadiusMeters() + " m, assigned to "
                        + (officer == null ? "nobody" : officer.getName()), info);
        return ShopResponse.from(s);
    }

    @Transactional
    public ShopResponse update(AppUserDetails admin, Long id, ShopRequest req, RequestInfo info) {
        Shop s = find(id);
        String code = blank(req.code()) ? s.getCode() : req.code().trim().toUpperCase(Locale.ROOT);
        if (!code.equalsIgnoreCase(s.getCode()) && repository.existsByCodeIgnoreCaseAndIdNot(code, id)) {
            throw ApiException.conflict("SHOP_CODE_TAKEN", "A shop with the code " + code + " already exists.");
        }
        User officer = resolveOfficer(req.assignedOfficerId());
        s.setCode(code);
        s.setName(req.name().trim());
        s.setLocality(clean(req.locality()));
        s.setRegion(clean(req.region()));
        s.setAddress(clean(req.address()));
        s.setPhone(clean(req.phone()));
        s.setLatitude(req.latitude());
        s.setLongitude(req.longitude());
        s.setAllowedRadiusMeters(radius(req));
        s.setAssignedOfficer(officer);
        if (req.status() != null) {
            s.setStatus(req.status());
        }
        s = repository.save(s);
        auditService.log(admin.getId(), AuditAction.SHOP_UPDATE,
                "Updated shop " + s.getCode() + " '" + s.getName() + "' radius " + s.getAllowedRadiusMeters() + " m, assigned to "
                        + (officer == null ? "nobody" : officer.getName()), info);
        return ShopResponse.from(s);
    }

    @Transactional
    public ShopResponse setStatus(AppUserDetails admin, Long id, StatusRequest req, RequestInfo info) {
        Shop s = find(id);
        s.setStatus(req.status());
        s = repository.save(s);
        auditService.log(admin.getId(), AuditAction.SHOP_STATUS_CHANGE,
                "Shop " + s.getCode() + " '" + s.getName() + "' is now " + s.getStatus(), info);
        return ShopResponse.from(s);
    }

    /**
     * Permanently removes a shop. Any attendance already recorded there is kept (the day, hours and photo all stay) -
     * only the link to this shop is cleared, since the shop itself no longer exists to point to.
     */
    @Transactional
    public void delete(AppUserDetails admin, Long id, RequestInfo info) {
        Shop s = find(id);
        int cleared = attendanceRepository.clearShopReferences(id);
        auditService.log(admin.getId(), AuditAction.SHOP_DELETE,
                "Deleted shop " + s.getCode() + " '" + s.getName() + "' (" + cleared + " past attendance record(s) kept, no longer linked to a shop)", info);
        repository.delete(s);
    }

    private Shop find(Long id) {
        return repository.findById(id).orElseThrow(() -> ApiException.notFound("Shop not found."));
    }

    private User resolveOfficer(Long officerId) {
        if (officerId == null) {
            return null;
        }
        User u = userRepository.findById(officerId)
                .orElseThrow(() -> ApiException.badRequest("INVALID_OFFICER", "The selected officer does not exist."));
        if (u.getRole() != Role.SO || u.getStatus() != Status.ACTIVE) {
            throw ApiException.badRequest("INVALID_OFFICER", "A shop can only be assigned to an active Sales Officer.");
        }
        return u;
    }

    private int radius(ShopRequest req) {
        return req.allowedRadiusMeters() == null ? props.getAttendance().getShopRadiusMeters() : req.allowedRadiusMeters();
    }

    private String nextCode() {
        long n = repository.count() + 1;
        String code;
        do {
            code = String.format("SHP%03d", n++);
        } while (repository.existsByCodeIgnoreCase(code));
        return code;
    }

    private static boolean blank(String v) {
        return v == null || v.isBlank();
    }

    private static String clean(String v) {
        return blank(v) ? null : v.trim();
    }
}
