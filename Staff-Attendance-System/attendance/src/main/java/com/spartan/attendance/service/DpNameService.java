package com.spartan.attendance.service;

import com.spartan.attendance.dto.DpNameResponse;
import com.spartan.attendance.entity.DpName;
import com.spartan.attendance.repository.DpNameRepository;
import com.spartan.attendance.repository.UserRepository;
import com.spartan.attendance.security.AppUserDetails;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Shared list of distributor (DP) names used by the DP Name dropdowns. Anyone signed in can add a new one. */
@Service
@RequiredArgsConstructor
public class DpNameService {

    private final DpNameRepository repository;
    private final UserRepository userRepository;

    @Transactional(readOnly = true)
    public List<DpNameResponse> list() {
        return repository.findAllByOrderByNameAsc().stream().map(DpNameResponse::from).toList();
    }

    /** Adding a name that already exists (any capitalisation) just returns the existing one. */
    @Transactional
    public DpNameResponse add(AppUserDetails caller, String name) {
        String clean = name.trim().replaceAll("\\s+", " ");
        return repository.findFirstByNameIgnoreCase(clean).map(DpNameResponse::from).orElseGet(() ->
                DpNameResponse.from(repository.save(DpName.builder()
                        .name(clean)
                        .createdBy(userRepository.findById(caller.getId()).orElse(null))
                        .build())));
    }
}
