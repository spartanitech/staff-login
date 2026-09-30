package com.spartan.attendance.repository;

import com.spartan.attendance.entity.SalesTarget;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SalesTargetRepository extends JpaRepository<SalesTarget, Long> {

    Optional<SalesTarget> findByOfficerIdAndMonth(Long officerId, String month);

    List<SalesTarget> findByMonth(String month);
}
