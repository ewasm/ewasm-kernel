(module
  (import "interface" "useGas" (func $useGas (param i32 i32)))
  (import "interface" "getGasLeftHigh" (func $getGasLeftHigh (result i32)))
  (import "interface" "getGasLeftLow" (func $getGasLeftLow (result i32)))
  ;; (import "interface" "callContract" (func $callContract (param i32 i32 i32 i32 i32 i32 i32 i32 i32) (result i32))) ;; async api
  (import "interface" "callContract" (func $callContract (param i32 i32 i32 i32 i32 i32 i32 i32) (result i32))) ;; sync api

  (export "useGas" (func $useGasShim))
  (export "getGasLeft" (func $getGasLeft))
  (export "call" (func $callShim))

  (func $useGasShim
    (param $amount i64)
    (call $useGas
                 (i32.wrap/i64 
                   (i64.shr_u (get_local $amount) (i64.const 32))) 
                 (i32.wrap/i64 (get_local $amount)))
  )

  (func $getGasLeft
    (result i64)
    (call $useGas (i32.const 0) (i32.const 2))
    (return 
      (i64.add
        (i64.shl (i64.extend_u/i32 (call $getGasLeftHigh)) (i64.const 32)) 
        (i64.extend_u/i32 (call $getGasLeftLow))))
  )

  ;; call shim needed because gas param is i64, but 64-bit int not supported by js
  (func $callShim
    (param i64 i32 i32 i32 i32 i32 i32)
    (result i32)
    (call $callContract
           (i32.wrap/i64
             (i64.shr_u (get_local 0) (i64.const 32)))
           (i32.wrap/i64 (get_local 0))
           (get_local 1)
           (get_local 2)
           (get_local 3)
           (get_local 4)
           (get_local 5)
           (get_local 6)
           ;; (get_local 7) ;; callback index for async api
    )
  )

)
