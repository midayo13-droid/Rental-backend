-- 누리상사 법인차량 예약·운행 기록 DB (DB설계.md, D안: 예약과 운행 분리)
-- 이 과제는 hw2 공간(스키마) 안에만 테이블을 만들어요. 1주차 과제 테이블과 섞이지 않아요.
-- __SCHEMA__ 는 scripts/db-init.ts 가 hw2 로 바꿔 넣어요.

CREATE SCHEMA IF NOT EXISTS __SCHEMA__;
SET search_path TO __SCHEMA__, public;

-- 같은 차 시간 겹침 금지(EXCLUDE)에 필요한 확장. 이미 켜져 있으면 건너뛰어요.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ① 부서 (고정 목록)
CREATE TABLE departments (
  id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

-- ② 로그인 계정 (고객·일반 직원·관리자)
CREATE TABLE users (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                text NOT NULL,
  password_hash        text NOT NULL,
  role                 text NOT NULL CHECK (role IN ('고객', '일반 직원', '관리자')),
  status               text NOT NULL DEFAULT '사용' CHECK (status IN ('사용', '정지')),
  must_change_password boolean NOT NULL DEFAULT false,
  created_at           timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

-- ③ 직원 명부 (가입하면 user_id 가 연결돼요)
CREATE TABLE employees (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_no    text NOT NULL UNIQUE,
  name           text NOT NULL,
  department_id  bigint NOT NULL REFERENCES departments (id),
  user_id        bigint UNIQUE REFERENCES users (id),
  license_expiry date,
  license_status text NOT NULL DEFAULT '미등록' CHECK (license_status IN ('미등록', '승인 대기', '승인')),
  CONSTRAINT employees_license_chk CHECK (license_status = '미등록' OR license_expiry IS NOT NULL)
);

-- ④ 차량
CREATE TABLE vehicles (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model            text NOT NULL,
  plate_no         text NOT NULL UNIQUE,
  seat_count       int  NOT NULL CHECK (seat_count >= 1),
  initial_odometer int  NOT NULL CHECK (initial_odometer >= 0)
);

-- ⑤ 점검 일정
CREATE TABLE maintenance_schedules (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id bigint NOT NULL REFERENCES vehicles (id),
  start_date date NOT NULL,
  end_date   date NOT NULL,
  reason     text NOT NULL,
  CONSTRAINT maintenance_dates_chk CHECK (end_date >= start_date),
  CONSTRAINT maintenance_no_overlap EXCLUDE USING gist (
    vehicle_id WITH =, daterange(start_date, end_date, '[]') WITH &&
  )
);

-- ⑥ 예약 (= 약속)
CREATE TABLE reservations (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id      bigint NOT NULL REFERENCES vehicles (id),
  driver_id       bigint NOT NULL REFERENCES employees (id),
  department_id   bigint NOT NULL REFERENCES departments (id),
  start_at        timestamp NOT NULL,
  end_at          timestamp NOT NULL,
  destination     text NOT NULL,
  passenger_count int NOT NULL CHECK (passenger_count >= 1),
  status          text NOT NULL DEFAULT '예약됨' CHECK (status IN ('예약됨', '운행 중', '확인 대기', '반납', '취소')),
  created_by      bigint NOT NULL REFERENCES users (id),
  canceled_by     bigint REFERENCES users (id),
  canceled_at     timestamp,
  created_at      timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul'),
  CONSTRAINT reservations_time_chk CHECK (end_at > start_at),
  CONSTRAINT reservations_max72_chk CHECK (end_at - start_at <= interval '72 hours'),
  CONSTRAINT reservations_cancel_chk CHECK (status <> '취소' OR (canceled_by IS NOT NULL AND canceled_at IS NOT NULL)),
  -- 같은 차: 앞 예약이 끝난 뒤 30분 여유까지 점유 ([V-4])
  CONSTRAINT reservations_vehicle_no_overlap EXCLUDE USING gist (
    vehicle_id WITH =, tsrange(start_at, end_at + interval '30 minutes') WITH &&
  ) WHERE (status <> '취소'),
  -- 같은 운전자: 다른 차라도 겹치면 안 됨 ([R-11])
  CONSTRAINT reservations_driver_no_overlap EXCLUDE USING gist (
    driver_id WITH =, tsrange(start_at, end_at) WITH &&
  ) WHERE (status <> '취소')
);
CREATE INDEX reservations_vehicle_idx ON reservations (vehicle_id, start_at);
CREATE INDEX reservations_driver_idx ON reservations (driver_id);

-- ⑥-2 운행 (= 출발을 누르면 생기는 실제 기록)
CREATE TABLE trips (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id    bigint NOT NULL UNIQUE REFERENCES reservations (id),
  start_odometer    int NOT NULL CHECK (start_odometer >= 0),
  departed_at       timestamp NOT NULL,
  end_odometer      int,
  return_entered_at timestamp,
  confirmed_by      bigint REFERENCES users (id),
  confirmed_at      timestamp,
  smoking_violation boolean NOT NULL DEFAULT false,
  CONSTRAINT trips_end_gt_start CHECK (end_odometer IS NULL OR end_odometer > start_odometer),
  CONSTRAINT trips_return_pair_chk CHECK ((end_odometer IS NULL) = (return_entered_at IS NULL)),
  CONSTRAINT trips_confirm_pair_chk CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT trips_confirm_after_return_chk CHECK (confirmed_by IS NULL OR end_odometer IS NOT NULL)
);

-- ⑦ 동승자 (직원 또는 외부 손님)
CREATE TABLE reservation_companions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL REFERENCES reservations (id),
  employee_id    bigint REFERENCES employees (id),
  guest_name     text,
  guest_org      text,
  CONSTRAINT companions_one_of_chk CHECK (
    (employee_id IS NOT NULL AND guest_name IS NULL) OR (employee_id IS NULL AND guest_name IS NOT NULL)
  )
);
CREATE UNIQUE INDEX companions_employee_uq ON reservation_companions (reservation_id, employee_id)
  WHERE employee_id IS NOT NULL;

-- ⑧ 주유 기록
CREATE TABLE fuel_records (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id           bigint NOT NULL REFERENCES trips (id),
  fueled_on         date NOT NULL,
  amount            int NOT NULL CHECK (amount > 0),
  liters            numeric(6, 2) NOT NULL CHECK (liters > 0),
  receipt_submitted boolean NOT NULL DEFAULT false
);

-- ⑨ 사고 기록
CREATE TABLE accidents (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id          bigint NOT NULL REFERENCES trips (id),
  accident_date    date NOT NULL,
  description      text NOT NULL,
  report_submitted boolean NOT NULL DEFAULT false,
  created_by       bigint NOT NULL REFERENCES users (id)
);

-- ⑩ 개인 차량 정산 (1km당 200원)
CREATE TABLE personal_vehicle_claims (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id   bigint NOT NULL REFERENCES employees (id),
  department_id bigint NOT NULL REFERENCES departments (id),
  travel_date   date NOT NULL,
  destination   text NOT NULL,
  distance_km   int NOT NULL CHECK (distance_km >= 1),
  rate_per_km   int NOT NULL CHECK (rate_per_km > 0),
  status        text NOT NULL DEFAULT '신청됨' CHECK (status IN ('신청됨', '승인됨', '반려됨', '취소')),
  decided_by    bigint REFERENCES users (id),
  decided_at    timestamp,
  reject_reason text,
  canceled_at   timestamp,
  created_at    timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul'),
  CONSTRAINT claims_decided_chk CHECK (status NOT IN ('승인됨', '반려됨') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT claims_reject_chk CHECK (status <> '반려됨' OR (reject_reason IS NOT NULL AND length(btrim(reject_reason)) > 0)),
  CONSTRAINT claims_cancel_chk CHECK (status <> '취소' OR canceled_at IS NOT NULL)
);
-- 같은 직원·같은 이용일에 (신청됨·승인됨) 한 건만 ([K-6])
CREATE UNIQUE INDEX claims_one_per_day_uq ON personal_vehicle_claims (employee_id, travel_date)
  WHERE status IN ('신청됨', '승인됨');
