/*global define*/
define([
        '../Core/TimeInterval',
        './CzmlBoolean',
        './CzmlNumber',
        './CzmlColor',
        './DynamicProperty',
        './DynamicMaterialProperty'
       ], function(
         TimeInterval,
         CzmlBoolean,
         CzmlNumber,
         CzmlColor,
         DynamicProperty,
         DynamicMaterialProperty) {
    "use strict";

    /**
     * Represents a time-dynamic cone, typically used in conjunction with DynamicConeVisualizer and
     * DynamicObjectCollection to visualize CZML.
     *
     * @name DynamicCone
     * @constructor
     *
     * @see DynamicObject
     * @see DynamicProperty
     * @see DynamicObjectCollection
     * @see DynamicConeVisualizer
     * @see VisualizerCollection
     * @see ComplexConicSensor
     * @see CzmlDefaults
     */
    function DynamicCone() {
        /**
         * A DynamicProperty of type CzmlNumber which determines the cone's minimum clock-angle.
         */
        this.minimumClockAngle = undefined;
        /**
         * A DynamicProperty of type CzmlNumber which determines the cone's maximum clock-angle.
         */
        this.maximumClockAngle = undefined;
        /**
         * A DynamicProperty of type CzmlNumber which determines the cone's inner half-angle.
         */
        this.innerHalfAngle = undefined;
        /**
         * A DynamicProperty of type CzmlNumber which determines the cone's outer half-angle.
         */
        this.outerHalfAngle = undefined;
        /**
         * A DynamicMaterialProperty which determines the cone's cap material.
         */
        this.capMaterial = undefined;
        /**
         * A DynamicMaterialProperty which determines the cone's inner material.
         */
        this.innerMaterial = undefined;
        /**
         * A DynamicMaterialProperty which determines the cone's outer material.
         */
        this.outerMaterial = undefined;
        /**
         * A DynamicMaterialProperty which determines the cone's silhouette material.
         */
        this.silhouetteMaterial = undefined;
        /**
         * A DynamicProperty of type CzmlColor which determines the color of the line formed by the intersection of the cone and other central bodies.
         */
        this.intersectionColor = undefined;
        /**
         * A DynamicProperty of type CzmlBoolean which determines the cone's intersection visibility
         */
        this.showIntersection = undefined;
        /**
         * A DynamicProperty of type CzmlNumber which determines the cone's radius.
         */
        this.radius = undefined;
        /**
         * A DynamicProperty of type CzmlBoolean which determines the cone's visibility
         */
        this.show = undefined;
    }

    /**
     * Processes a single CZML packet and merges its data into the provided DynamicObject's cone.
     * If the DynamicObject does not have a cone, one is created.  This method is not
     * normally called directly, but is part of the array of CZML processing functions that is
     * passed into the DynamicObjectCollection constructor.
     *
     * @param {DynamicObject} dynamicObject The DynamicObject which will contain the cone data.
     * @param {Object} packet The CZML packet to process.
     * @returns {Boolean} true if any new properties were created while processing the packet, false otherwise.
     *
     * @see DynamicObject
     * @see DynamicProperty
     * @see DynamicObjectCollection
     * @see CzmlDefaults#updaters
     */
    DynamicCone.processCzmlPacket = function(dynamicObject, packet) {
        var coneData = packet.cone;
        var coneUpdated = false;
        if (typeof coneData !== 'undefined') {
            var cone = dynamicObject.cone;
            coneUpdated = typeof cone === 'undefined';
            if (coneUpdated) {
                dynamicObject.cone = cone = new DynamicCone();
            }

            var interval = coneData.interval;
            if (typeof interval !== 'undefined') {
                interval = TimeInterval.fromIso8601(interval);
            }

            coneUpdated = DynamicProperty.processCzmlPacket(cone, 'show', CzmlBoolean, coneData.show, interval) || coneUpdated;
            coneUpdated = DynamicProperty.processCzmlPacket(cone, 'innerHalfAngle', CzmlNumber, coneData.innerHalfAngle, interval) || coneUpdated;
            coneUpdated = DynamicProperty.processCzmlPacket(cone, 'outerHalfAngle', CzmlNumber, coneData.outerHalfAngle, interval) || coneUpdated;
            coneUpdated = DynamicProperty.processCzmlPacket(cone, 'minimumClockAngle', CzmlNumber, coneData.minimumClockAngle, interval) || coneUpdated;
            coneUpdated = DynamicProperty.processCzmlPacket(cone, 'maximumClockAngle', CzmlNumber, coneData.maximumClockAngle, interval) || coneUpdated;
            coneUpdated = DynamicProperty.processCzmlPacket(cone, 'radius', CzmlNumber, coneData.radius, interval) || coneUpdated;
            coneUpdated = DynamicProperty.processCzmlPacket(cone, 'showIntersection', CzmlBoolean, coneData.showIntersection, interval) || coneUpdated;
            coneUpdated = DynamicProperty.processCzmlPacket(cone, 'intersectionColor', CzmlColor, coneData.intersectionColor, interval) || coneUpdated;
            coneUpdated = DynamicMaterialProperty.processCzmlPacket(cone, 'capMaterial', coneData.capMaterial, interval) || coneUpdated;
            coneUpdated = DynamicMaterialProperty.processCzmlPacket(cone, 'innerMaterial', coneData.innerMaterial, interval) || coneUpdated;
            coneUpdated = DynamicMaterialProperty.processCzmlPacket(cone, 'outerMaterial', coneData.outerMaterial, interval) || coneUpdated;
            coneUpdated = DynamicMaterialProperty.processCzmlPacket(cone, 'silhouetteMaterial', coneData.silhouetteMaterial, interval) || coneUpdated;
        }
        return coneUpdated;
    };

    /**
     * Given two DynamicObjects, takes the cone properties from the second
     * and assigns them to the first, assuming such a property did not already exist.
     * This method is not normally called directly, but is part of the array of CZML processing
     * functions that is passed into the CompositeDynamicObjectCollection constructor.
     *
     * @param {DynamicObject} targetObject The DynamicObject which will have properties merged onto it.
     * @param {DynamicObject} objectToMerge The DynamicObject containing properties to be merged.
     *
     * @see CzmlDefaults
     */
    DynamicCone.mergeProperties = function(targetObject, objectToMerge) {
        var coneToMerge = objectToMerge.cone;
        if (typeof coneToMerge !== 'undefined') {

            var targetCone = targetObject.cone;
            if (typeof targetCone === 'undefined') {
                targetObject.cone = targetCone = new DynamicCone();
            }

            targetCone.show = targetCone.show || coneToMerge.show;
            targetCone.innerHalfAngle = targetCone.innerHalfAngle || coneToMerge.innerHalfAngle;
            targetCone.outerHalfAngle = targetCone.outerHalfAngle || coneToMerge.outerHalfAngle;
            targetCone.minimumClockAngle = targetCone.minimumClockAngle || coneToMerge.minimumClockAngle;
            targetCone.maximumClockAngle = targetCone.maximumClockAngle || coneToMerge.maximumClockAngle;
            targetCone.radius = targetCone.radius || coneToMerge.radius;
            targetCone.showIntersection = targetCone.showIntersection || coneToMerge.showIntersection;
            targetCone.intersectionColor = targetCone.intersectionColor || coneToMerge.intersectionColor;
            targetCone.capMaterial = targetCone.capMaterial || coneToMerge.capMaterial;
            targetCone.innerMaterial = targetCone.innerMaterial || coneToMerge.innerMaterial;
            targetCone.outerMaterial = targetCone.outerMaterial || coneToMerge.outerMaterial;
            targetCone.silhouetteMaterial = targetCone.silhouetteMaterial || coneToMerge.silhouetteMaterial;
        }
    };

    /**
     * Given a DynamicObject, undefines the cone associated with it.
     * This method is not normally called directly, but is part of the array of CZML processing
     * functions that is passed into the CompositeDynamicObjectCollection constructor.
     *
     * @param {DynamicObject} dynamicObject The DynamicObject to remove the cone from.
     *
     * @see CzmlDefaults
     */
    DynamicCone.undefineProperties = function(dynamicObject) {
        dynamicObject.cone = undefined;
    };

    return DynamicCone;
});