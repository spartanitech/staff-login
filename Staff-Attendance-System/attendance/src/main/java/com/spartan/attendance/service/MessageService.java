package com.spartan.attendance.service;

import com.spartan.attendance.dto.MessageRequest;
import com.spartan.attendance.dto.MessageResponse;
import com.spartan.attendance.entity.PortalMessage;
import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.exception.ApiException;
import com.spartan.attendance.repository.PortalMessageRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import com.spartan.attendance.util.TimeUtil;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The portal message board, kept on the server so a message reaches the other person's phone.
 *
 * Who sees a message:
 *   ADMIN / OWNER   every message
 *   everyone else   messages they sent, messages to "all", to their role, to them by name,
 *                   and messages sent by anyone in their own reporting tree (a manager can follow their team)
 * Who may write to whom: an SO / ASM / RM / RSM may address a named person only if that person is in their own
 * reporting tree or above them (their managers) - so an ASM cannot message another ASM's officers by name.
 */
@Service
@RequiredArgsConstructor
public class MessageService {

    private static final int MAX_LIST = 500;
    private static final int KEEP_DAYS = 180;

    public static final Map<Role, String> ROLE_TITLE = Map.of(
            Role.ADMIN, "Admin", Role.OWNER, "Owner", Role.RSM, "Marketing Manager",
            Role.RM, "Regional Manager", Role.ASM, "Area Sales Manager", Role.SO, "Sales Officer");

    private final PortalMessageRepository repository;
    private final UserRepository userRepository;
    private final ScopeService scopeService;

    @Transactional(readOnly = true)
    public List<MessageResponse> list(AppUserDetails caller) {
        ScopeService.Scope scope = scopeService.scopeOf(caller);
        String myRole = ROLE_TITLE.get(caller.getRole());
        User me = userRepository.findById(caller.getId()).orElseThrow(() -> ApiException.notFound("User not found."));
        String myPersonKey = "person:" + me.getName().trim();
        return repository.findRecent(TimeUtil.nowIst().minusDays(KEEP_DAYS), PageRequest.of(0, MAX_LIST)).stream()
                .filter(m -> scope.all()
                        || m.getSender().getId().equals(me.getId())
                        || "all".equals(m.getToKey())
                        || m.getToKey().equalsIgnoreCase(myRole)
                        || (m.getRecipient() != null && m.getRecipient().getId().equals(me.getId()))
                        || (m.getRecipient() == null && m.getToKey().equalsIgnoreCase(myPersonKey))
                        || scope.contains(m.getSender().getId()))
                .map(MessageResponse::from)
                .toList();
    }

    @Transactional
    public MessageResponse send(AppUserDetails caller, MessageRequest req) {
        User me = userRepository.findById(caller.getId()).orElseThrow(() -> ApiException.notFound("User not found."));
        String to = req.to().trim();
        User recipient = null;
        if (to.regionMatches(true, 0, "person:", 0, 7)) {
            String name = to.substring(7).trim();
            if (name.isEmpty()) {
                throw ApiException.badRequest("BAD_RECIPIENT", "Choose who the message is for.");
            }
            recipient = findActiveByName(name);
            if (recipient == null) {
                throw ApiException.badRequest("UNKNOWN_RECIPIENT", "There is no active staff member called '" + name + "'.");
            }
            assertMayAddress(caller, me, recipient);
            to = "person:" + recipient.getName();
        } else if (!"all".equalsIgnoreCase(to) && !ROLE_TITLE.containsValue(to)) {
            throw ApiException.badRequest("BAD_RECIPIENT", "Send to everyone, a role, or one named person.");
        } else if ("all".equalsIgnoreCase(to)) {
            to = "all";
        }
        PortalMessage m = PortalMessage.builder()
                .sender(me).senderName(me.getName()).senderRole(ROLE_TITLE.get(me.getRole()))
                .toKey(to).recipient(recipient).text(req.text().trim())
                .build();
        return MessageResponse.from(repository.save(m));
    }

    @Transactional
    public MessageResponse edit(AppUserDetails caller, Long id, String text) {
        PortalMessage m = own(caller, id);
        if (text == null || text.isBlank()) {
            throw ApiException.badRequest("EMPTY_MESSAGE", "Type a message first.");
        }
        m.setText(text.trim().length() > 2000 ? text.trim().substring(0, 2000) : text.trim());
        return MessageResponse.from(repository.save(m));
    }

    @Transactional
    public void delete(AppUserDetails caller, Long id) {
        repository.delete(own(caller, id));
    }

    // ---- helpers ----

    /** Only the sender (or an Admin) may change or remove a message. */
    private PortalMessage own(AppUserDetails caller, Long id) {
        PortalMessage m = repository.findById(id).orElseThrow(() -> ApiException.notFound("Message not found."));
        if (caller.getRole() != Role.ADMIN && !m.getSender().getId().equals(caller.getId())) {
            throw ApiException.forbidden("NOT_YOUR_MESSAGE", "You can only change messages you sent.");
        }
        return m;
    }

    private User findActiveByName(String name) {
        return userRepository.findAllWithManager().stream()
                .filter(u -> u.getStatus() == Status.ACTIVE && u.getName() != null && u.getName().trim().equalsIgnoreCase(name))
                .findFirst().orElse(null);
    }

    /** Managers and officers write to their own tree or up their own chain; Admin / Owner write to anyone. */
    private void assertMayAddress(AppUserDetails caller, User me, User recipient) {
        if (caller.getRole().hasGlobalScope() || recipient.getRole().hasGlobalScope()) {
            return;
        }
        if (scopeService.scopeOf(caller).contains(recipient.getId())) {
            return;
        }
        User cursor = me.getReportingManager();
        int guard = 0;
        while (cursor != null && guard++ < 50) {
            if (cursor.getId().equals(recipient.getId())) {
                return;
            }
            cursor = cursor.getReportingManager();
        }
        throw ApiException.forbidden("OUT_OF_SCOPE", "You can only message people in your own team or your managers.");
    }
}
