;(function () {
  'use strict'

  /**
   * The behavior creator. Thingdefs reference behaviors by name + params
   * (data); the implementations registry (behaviors/implementations/) turns
   * each entry into a live implementation with the params closed over.
   * Adding a behavior = one implementation file, zero engine edits.
   */
  window.Footie.behaviors.createBehavior = function createBehavior([name, params]) {
    const factory = window.Footie.behaviors.implementations[name]
    if (!factory) throw new Error(`createBehavior: unknown behavior "${name}"`)
    return factory(params)
  }
})()
