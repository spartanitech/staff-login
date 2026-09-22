package com.spartan.attendance.repository;

import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.WorkLocation;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkLocationRepository extends JpaRepository<WorkLocation, Long> {

    List<WorkLocation> findByStatusOrderByNameAsc(Status status);

    List<WorkLocation> findAllByOrderByNameAsc();

    boolean existsByNameIgnoreCase(String name);
}
