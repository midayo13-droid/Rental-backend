# 백엔드 API 요약

모든 주소는 `http://localhost:4000` 기준. 로그인한 뒤에는 `Authorization: Bearer <token>` 을 함께 보냅니다.
오류는 `{ statusCode, message }` (message 는 화면에 그대로 보여 줄 수 있는 쉬운 한국어). 일부는 `code` 도 있음:
`DISTANCE_WARNING`(경고 후 `acknowledge:true` 로 다시 보내기), `MUST_CHANGE_PASSWORD`(403, 임시 비밀번호).
401 = 로그인 필요/시간 끝남/정지. 403 = 권한 없음. 시각은 한국 시간 문자열 `YYYY-MM-DDTHH:mm:ss`, 날짜는 `YYYY-MM-DD`.
목록은 `?page=1&size=20` 을 주면 `{items,total,page,size}`, 안 주면 같은 모양으로 전체.
JSON 키는 camelCase.

역할: `'고객' | '일반 직원' | '관리자'`. 총무팀 = 일반 직원 + 관리자. 코어 웹은 모든 역할이 쓰고(자기 것만), 어드민은 총무팀만.

## 인증 (공개: signup, login)
- POST `/auth/signup` {employeeNo,name,email,password} → {token,user}
- POST `/auth/login` {email,password} → {token,user}
- GET `/auth/me` → user: {id,email,role,mustChangePassword,employeeId,employeeNo,name,departmentId,departmentName,licenseStatus('미등록'|'승인 대기'|'승인'),licenseExpiry}
- POST `/auth/change-password` {currentPassword,newPassword}

## 직원·부서·면허
- GET `/departments` → [{id,name}]
- GET `/employees?q=&departmentId=&page=&size=` → 총무팀: {id,employeeNo,name,departmentId,departmentName,licenseStatus,licenseExpiry,hasAccount,role}, 고객: {id,name,departmentName}(동승자 선택용)
- PATCH `/employees/me/license` {expiry:'YYYY-MM-DD'} → 승인 대기로 바뀜
- (총무팀) GET `/employees/license-pending` / POST `/employees/:id/license/approve` (자기 면허 불가 403)
- (총무팀) GET `/employees/license-expiring` → {expiring:[{id,name,departmentName,licenseExpiry,daysLeft}], expiredReservations:[{id,startAt,endAt,status,model,plateNo,driverName,licenseExpiry}]}

## 차량·점검
- GET `/vehicles` → [{id,model,plateNo,seatCount,initialOdometer}] / (총무팀) PATCH `/vehicles/:id` {model?,plateNo?,seatCount?}
- (총무팀) GET `/maintenance` → [{id,vehicleId,model,plateNo,startDate,endDate,reason}]
- (총무팀) POST `/maintenance` {vehicleId,startDate,endDate,reason} (예약이 있으면 409, 응답에 reservations) / (관리자) DELETE `/maintenance/:id`

## 예약·운행
- GET `/reservations?status=&vehicleId=&departmentId=&from=&to=&q=&mine=1&page=&size=` — 고객은 항상 내 것만, 총무팀은 전체(mine=1 이면 내 것만).
  행: {id,vehicleId,model,plateNo,driverId,driverName,departmentName,startAt,endAt,destination,passengerCount,status('예약됨'|'운행 중'|'확인 대기'|'반납'|'취소'),createdAt,tripId,startOdometer,endOdometer,confirmedBy,confirmedAt,smokingViolation,overdue(bool),distanceWarning(bool)}
- (총무팀) GET `/reservations/overdue` → 위 행 + overdueMinutes (미반납: 운행 중이고 끝 시각 +30분 경과)
- GET `/reservations/availability?date=YYYY-MM-DD` → {date,vehicles:[{id,model,plateNo,seatCount,reservations:[{id,vehicleId,startAt,endAt,status,(총무팀만)driverName,departmentName}],maintenance:[{startDate,endDate,reason}]}]}
- GET `/reservations/:id` → 행 + {isMine,trip:{id,startOdometer,departedAt,endOdometer,returnEnteredAt,confirmedBy,confirmedAt,confirmedByName,smokingViolation}|null, companions:[{id,employeeId,name,guestOrg,isGuest,departmentName}], fuel:[{id,fueledOn,amount,liters,receiptSubmitted}], accidents:[…]}
- POST `/reservations` {vehicleId,startAt,endAt,destination,passengerCount,companions:[{employeeId}|{guestName,guestOrg?}]} → {id}  (규칙 위반은 400/409 + 쉬운 message)
- POST `/reservations/:id/cancel` — 본인은 출발 전까지, 총무팀은 대리
- POST `/reservations/:id/depart` (본인) → {startOdometer}
- POST `/reservations/:id/fuel` {fueledOn?,amount,liters} (운행 중·확인 대기, 본인 또는 총무팀)
- POST `/reservations/:id/return` {endOdometer,acknowledge?} (본인) — 500km 넘으면 400 `DISTANCE_WARNING`, acknowledge:true 로 재전송
- (총무팀) POST `/reservations/:id/confirm` {smokingViolation?} — 자기 운행 확인 불가 403
- (총무팀) PATCH `/reservations/:id/start-odometer` {startOdometer}
- PATCH `/fuel-records/:id` {receiptSubmitted?(총무팀),amount?,liters?}

## 사고 기록 (총무팀)
- GET `/accidents` → {items:[{id,accidentDate,description,reportSubmitted,reservationId,model,plateNo,driverName,reportOverdue}],total}
- GET `/accidents/reservations` → 사고를 연결할 수 있는 예약 목록(운행 기록이 있는 것)
- POST `/accidents` {reservationId,accidentDate,description,reportSubmitted?} / PATCH `/accidents/:id` {description?,reportSubmitted?}

## 개인 차량 정산 (1km당 200원)
- GET `/claims?status=&mine=1&page=&size=` — 고객은 내 것만. 행: {id,employeeId,employeeName,departmentName,travelDate,destination,distanceKm,ratePerKm,amount,distanceWarning,status('신청됨'|'승인됨'|'반려됨'|'취소'),decidedAt,rejectReason,canceledAt,createdAt}
- POST `/claims` {travelDate,destination,distanceKm,acknowledge?} → {id,amount} (1,000km 넘으면 400 DISTANCE_WARNING)
- POST `/claims/:id/cancel` (본인, 신청됨일 때)
- (총무팀) POST `/claims/:id/approve` / POST `/claims/:id/reject` {reason} — 자기 신청 불가 403
- (총무팀) GET `/claims/monthly?month=YYYY-MM` → {month,total,byEmployee:[{employeeId,name,departmentName,claimCount,distanceKm,amount}],byDepartment:[{departmentId,departmentName,claimCount,distanceKm,amount}]}

## 통계 (총무팀)
- GET `/stats/home` → {confirmWaiting,overdue,licensePending,licenseExpiring,claimsPending,accidentsOverdue}
- GET `/stats/vehicles-monthly?month=` → {month,items:[{vehicleId,model,plateNo,tripCount,distanceKm,fuelAmount,fuelLiters,costPerKm|null}]}
- GET `/stats/departments-monthly?month=` → {month,items:[{departmentId,departmentName,useCount,distanceKm}]}

## 총무팀 계정 관리 (관리자만)
- GET `/accounts` → [{id,email,role,status('사용'|'정지'),mustChangePassword,createdAt,employeeId,employeeNo,name,departmentName}]
- GET `/accounts/candidates` → 계정이 없는 총무팀 직원 [{id,employeeNo,name}]
- POST `/accounts` {employeeId,email,role} → {id,tempPassword} / PATCH `/accounts/:id` {role?,status?} / POST `/accounts/:id/reset-password` → {tempPassword}

## 가상 데이터 (관리자만)
- POST `/admin/reset-demo` → 활동 데이터(예약·운행·동승자·주유·사고·점검·정산)를 지우고 처음 가상 데이터로 다시 채움. 계정·직원 명부·차량·부서는 유지. `DEMO_RESET_ENABLED=false` 이면 403.

## 규정 챗봇
- GET `/chat/status` → {connected} / POST `/chat` {message,conversationId?} → {answer,conversationId} (연결 전이면 503 + 쉬운 message)
