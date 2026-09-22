package com.spartan.attendance.service;

import com.spartan.attendance.dto.AuditLogResponse;
import com.spartan.attendance.dto.PageResponse;
import com.spartan.attendance.entity.AuditAction;
import com.spartan.attendance.entity.AuditLog;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.repository.AuditLogRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.util.RequestInfo;
import com.spartan.attendance.util.TimeUtil;
import jakarta.persistence.criteria.Predicate;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuditService {

    private final AuditLogRepository auditLogRepository;
    private final UserRepository userRepository;

    /** Append-only. There is no update or delete path for audit rows anywhere in the API. */
    public void log(Long userId, AuditAction action, String description, RequestInfo info) {
        String desc = description == null ? null : (description.length() > 1000 ? description.substring(0, 1000) : description);
        auditLogRepository.save(AuditLog.builder()
                .userId(userId)
                .action(action)
                .description(desc)
                .ipAddress(info == null ? null : info.ipAddress())
                .userAgent(info == null ? null : info.userAgent())
                .timestamp(TimeUtil.nowIst())
                .build());
    }

    @Transactional(readOnly = true)
    public PageResponse<AuditLogResponse> search(Long userId, AuditAction action, LocalDate from, LocalDate to,
                                                 int page, int size) {
        Specification<AuditLog> spec = (root, query, cb) -> {
            List<Predicate> p = new ArrayList<>();
            if (userId != null) {
                p.add(cb.equal(root.get("userId"), userId));
            }
            if (action != null) {
                p.add(cb.equal(root.get("action"), action));
            }
            if (from != null) {
                p.add(cb.greaterThanOrEqualTo(root.<LocalDateTime>get("timestamp"), from.atStartOfDay()));
            }
            if (to != null) {
                p.add(cb.lessThan(root.<LocalDateTime>get("timestamp"), to.plusDays(1).atStartOfDay()));
            }
            return cb.and(p.toArray(new Predicate[0]));
        };
        int safeSize = Math.min(Math.max(size, 1), 200);
        Page<AuditLog> result = auditLogRepository.findAll(spec,
                PageRequest.of(Math.max(page, 0), safeSize, Sort.by(Sort.Direction.DESC, "timestamp", "id")));

        Set<Long> ids = result.getContent().stream().map(AuditLog::getUserId).filter(java.util.Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, String> names = new HashMap<>();
        for (User u : userRepository.findAllById(ids)) {
            names.put(u.getId(), u.getName());
        }
        return PageResponse.of(result.map(l -> AuditLogResponse.from(l, l.getUserId() == null ? null : names.get(l.getUserId()))));
    }
}
