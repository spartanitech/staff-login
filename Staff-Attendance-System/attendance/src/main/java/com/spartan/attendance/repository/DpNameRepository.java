package com.spartan.attendance.repository;

import com.spartan.attendance.entity.DpName;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DpNameRepository extends JpaRepository<DpName, Long> {

    List<DpName> findAllByOrderByNameAsc();

    Optional<DpName> findFirstByNameIgnoreCase(String name);
}
