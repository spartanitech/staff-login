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

/** Shops a Sales Officer can mark attendance at. Added by the Admin, a manager for their team, or the Sales Officer for themselves. */
@Service
@RequiredArgsConstructor
public class ShopService {

    private final ShopRepository repository;
    private final UserRepository userRepository;
    private final AttendanceRepository attendanceRepository;
    private final AuditService auditService;
    private final AppProperties props;
    private final ScopeService scopeService;

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
                .city(clean(req.city()))
                .address(clean(req.address()))
                .phone(clean(req.phone()))
                .productCategories(clean(req.productCategories()))
                .latitude(req.latitude())
                .longitude(req.longitude())
                .allowedRadiusMeters(radius(req))
                .assignedOfficer(officer)
                .createdBy(userRepository.findById(admin.getId()).orElse(null))
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
        if (req.city() != null) {            // older clients (admin console) don't send a city - keep what is there
            s.setCity(clean(req.city()));
        }
        s.setAddress(clean(req.address()));
        s.setPhone(clean(req.phone()));
        if (req.productCategories() != null) {   // older clients don't send it - keep what is there
            s.setProductCategories(clean(req.productCategories()));
        }
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

    // ------------------------------------------------------------------ Sales Officer adds their own shop

    /**
     * A Sales Officer adds a shop they work at. The server always assigns it to the caller, generates the code, uses the
     * default radius and makes it ACTIVE - whatever the request says about those. The latitude/longitude are the
     * officer's GPS position taken at the shop. Because it is assigned to the officer, it shows up in GET /api/shops/mine
     * (shop check-in) and in their ASM's / RM's Team Shops at once.
     */
    @Transactional
    public ShopResponse createOwn(AppUserDetails officer, ShopRequest req, RequestInfo info) {
        rejectDuplicateName(req.name(), officer.getId(), null);
        ShopRequest own = new ShopRequest(null, req.name(), req.locality(), req.region(), req.address(), req.phone(),
                req.latitude(), req.longitude(), null, officer.getId(), Status.ACTIVE, req.city(), req.productCategories());
        return create(officer, own, info);
    }

    // ------------------------------------------------------------------ team shops (ASM / RM / RSM)
    // The Area Sales Manager adds the shops their Sales Officers work. A manager only ever sees and changes shops that
    // are assigned to a Sales Officer in their own reporting tree (or that they added themselves); ADMIN/OWNER see all.

    /** Shops assigned to anyone in the caller's scope, plus any the caller added themselves (even if unassigned). */
    @Transactional(readOnly = true)
    public List<ShopResponse> teamList(AppUserDetails caller, Long officerId) {
        ScopeService.Scope scope = scopeService.scopeOf(caller);
        if (officerId != null) {
            scopeService.assertVisible(caller, officerId);
        }
        Specification<Shop> everything = (root, q, cb) -> cb.conjunction();
        return repository.findAll(everything, Sort.by("name")).stream()
                .filter(s -> teamVisible(caller, scope, s))
                .filter(s -> officerId == null
                        || (s.getAssignedOfficer() != null && officerId.equals(s.getAssignedOfficer().getId())))
                .map(ShopResponse::from)
                .toList();
    }

    @Transactional
    public ShopResponse teamCreate(AppUserDetails caller, ShopRequest req, RequestInfo info) {
        requireTeamOfficer(caller, req.assignedOfficerId());
        rejectDuplicateName(req.name(), req.assignedOfficerId(), null);
        return create(caller, stripCode(req), info);
    }

    @Transactional
    public ShopResponse teamUpdate(AppUserDetails caller, Long id, ShopRequest req, RequestInfo info) {
        Shop s = find(id);
        if (!teamVisible(caller, scopeService.scopeOf(caller), s)) {
            throw ApiException.forbidden("OUT_OF_SCOPE", "You can only change shops of your own team.");
        }
        requireTeamOfficer(caller, req.assignedOfficerId());
        rejectDuplicateName(req.name(), req.assignedOfficerId(), id);
        return update(caller, id, stripCode(req), info);
    }

    @Transactional
    public void teamDelete(AppUserDetails caller, Long id, RequestInfo info) {
        Shop s = find(id);
        if (!teamVisible(caller, scopeService.scopeOf(caller), s)) {
            throw ApiException.forbidden("OUT_OF_SCOPE", "You can only remove shops of your own team.");
        }
        delete(caller, id, info);
    }

    private boolean teamVisible(AppUserDetails caller, ScopeService.Scope scope, Shop s) {
        if (scope.all()) {
            return true;
        }
        if (s.getCreatedBy() != null && caller.getId().equals(s.getCreatedBy().getId())) {
            return true;
        }
        return s.getAssignedOfficer() != null && scope.contains(s.getAssignedOfficer().getId());
    }

    /** A manager must hand the shop to one of their own Sales Officers (ADMIN/OWNER may leave it unassigned). */
    private void requireTeamOfficer(AppUserDetails caller, Long officerId) {
        if (officerId == null) {
            if (caller.getRole().hasGlobalScope()) {
                return;
            }
            throw ApiException.badRequest("OFFICER_REQUIRED", "Choose the Sales Officer this shop is for.");
        }
        if (!scopeService.scopeOf(caller).contains(officerId)) {
            throw ApiException.forbidden("OUT_OF_SCOPE", "You can only assign shops to Sales Officers in your own team.");
        }
    }

    private void rejectDuplicateName(String name, Long officerId, Long id) {
        if (name == null || officerId == null) {
            return;
        }
        boolean taken = id == null
                ? repository.existsByNameIgnoreCaseAndAssignedOfficerId(name.trim(), officerId)
                : repository.existsByNameIgnoreCaseAndAssignedOfficerIdAndIdNot(name.trim(), officerId, id);
        if (taken) {
            throw ApiException.conflict("SHOP_NAME_TAKEN", "This Sales Officer already has a shop called '" + name.trim() + "'.");
        }
    }

    /** Managers never pick shop codes; the server generates them. */
    private static ShopRequest stripCode(ShopRequest r) {
        return new ShopRequest(null, r.name(), r.locality(), r.region(), r.address(), r.phone(), r.latitude(), r.longitude(),
                r.allowedRadiusMeters(), r.assignedOfficerId(), r.status(), r.city(), r.productCategories());
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
