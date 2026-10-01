package com.spartan.attendance.repository;

import com.spartan.attendance.entity.PortalMessage;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PortalMessageRepository extends JpaRepository<PortalMessage, Long> {

    @Query("select m from PortalMessage m join fetch m.sender left join fetch m.recipient "
            + "where m.createdAt >= :since order by m.createdAt desc")
    List<PortalMessage> findRecent(@Param("since") LocalDateTime since, Pageable page);

    @Modifying
    @Query("update PortalMessage m set m.recipient = null where m.recipient.id = :userId")
    int clearRecipient(@Param("userId") Long userId);

    @Modifying
    @Query("delete from PortalMessage m where m.sender.id = :userId")
    int deleteBySenderId(@Param("userId") Long userId);
}
