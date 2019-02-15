// @flow
import React, { useRef, useState, useEffect, useReducer } from 'react';
import produce from 'immer';

import {
  DEFAULT_PEAKS_CURVE,
  useUndo,
  updateDisabledParams,
  shuffleParameters,
  getRandomSeed,
  isUpdatePartOfGroup,
} from './SlopesState.helpers';
import {
  retrieveLastSessionSlopesParams,
  setSlopesParams,
} from '../../helpers/local-storage.helpers';
import analytics from '../../services/analytics.service';
import { sum, mean, sample, debounce } from '../../utils';

import type { Curve } from '../../types';

const HISTORY_SIZE_LIMIT = 5;

// $FlowIgnore
export const SlopesContext = React.createContext({});

export type ToggleParameterAction = (parameterName: string) => void;
export type TweakParameterAction = (key: string, value: any) => void;
export type RandomizeAction = () => void;

type HistorySnapshot = {
  parameters: any,
  timestamp: number, // Unix epoch
};

const defaultParameters = {
  seed: getRandomSeed(),
  enableDarkMode: sample([true, false]),
  enableMargins: sample([true, false]),
  enableOcclusion: true,
  amplitudeAmount: 50,
  wavelength: 25,
  octaveAmount: 0,
  perspective: 45,
  lineAmount: 45,
  spikyness: 0,
  staticAmount: 0,
  polarAmount: 0,
  omega: 0,
  splitUniverse: 0,
  personInflateAmount: 50,
  waterBoilAmount: 100,
  ballSize: 50,
  dotAmount: 0,
  peaksCurve: DEFAULT_PEAKS_CURVE,
  enableMirrored: false, // SECRET PARAM :o
};

const poweredOffParameters = {
  amplitudeAmount: 0,
  wavelength: 0,
  octaveAmount: 0,
  perspective: 0,
  lineAmount: 0,
  spikyness: 0,
  staticAmount: 0,
  polarAmount: 0,
  omega: 0,
  splitUniverse: 0,
  personInflateAmount: 0,
  waterBoilAmount: 0,
  ballSize: 0,
  dotAmount: 0,
};

type Parameters = {
  seed: number,
  enableDarkMode: boolean,
  enableMargins: boolean,
  enableOcclusion: boolean,
  amplitudeAmount: number,
  wavelength: number,
  octaveAmount: number,
  perspective: number,
  lineAmount: number,
  spikyness: number,
  staticAmount: number,
  polarAmount: number,
  omega: number,
  splitUniverse: number,
  personInflateAmount: number,
  waterBoilAmount: number,
  ballSize: number,
  dotAmount: number,
  peaksCurve: Curve,
  enableMirrored: boolean,
};

type State = {
  history: Array<HistorySnapshot>,
  animateTransitions: boolean,
  isPoweredOn: boolean,
  parameters: Parameters,
};

let times = [];

const trackParameterChange = debounce(controlName => {
  analytics.logEvent('change-control-value', {
    machineName: 'slopes',
    controlName,
  });
}, 600);

const reducer = produce(
  (state: State, action): State => {
    switch (action.type) {
      case 'TOGGLE_PARAMETER': {
        const { parameterName } = action;

        const currentValue = state.parameters[parameterName];

        state.parameters[parameterName] = !currentValue;

        return state;
      }

      case 'TWEAK_PARAMETER': {
        state.animateTransitions = true;

        // If this is the first action in a "burst", we want to push the state
        // onto the history stack, for undoing.
        //
        // I don't want to just save every action, because while a user drags
        // a slider, it can create dozens of subtle state changes.
        //
        // The easiest thing is just to debounce it, only tracking the first in a
        // batch.
        const lastHistorySnapshot = state.history[state.history.length - 1];
        const isFirstInBatch =
          !lastHistorySnapshot || !isUpdatePartOfGroup(lastHistorySnapshot);

        if (isFirstInBatch) {
          const newHistorySnapshot = {
            parameters: action.payload,
            timestamp: Date.now(),
          };

          state.history.push(newHistorySnapshot);

          if (state.history.length > HISTORY_SIZE_LIMIT) {
            state.history.shift();
          }
        } else {
          // If this is just one of many in the batch, I should update the
          // timestamp
          if (lastHistorySnapshot) {
            lastHistorySnapshot.timestamp = Date.now();
          }
        }

        // Update the state, by copying every value in the payload into state.
        Object.keys(action.payload).forEach(key => {
          state.parameters[key] = action.payload[key];
        });

        return state;
      }

      case 'SHUFFLE': {
        // NOTE: I'm mutating the `state` object passed in, but that's OK since
        // it's using immer.
        return shuffleParameters(state);
      }

      case 'TOGGLE_MACHINE_POWER': {
        // The first time the button is clicked, we turn the machine off.
        // This will blank out all the controls, and reset them to a "bottom"
        // value.
        if (state.isPoweredOn) {
          state.isPoweredOn = false;
          state.animateTransitions = false;

          Object.keys(poweredOffParameters).forEach(paramKey => {
            state.parameters[paramKey] = poweredOffParameters[paramKey];
          });

          return state;
        }

        state.isPoweredOn = true;
        state.animateTransitions = false;

        state.parameters = {
          ...defaultParameters,
          enableDarkMode: state.parameters.enableDarkMode,
          enableMargins: state.parameters.enableMargins,
        };

        return state;
      }

      case 'UNDO': {
        if (state.history.length === 0) {
          return state;
        }

        const lastState = state.history.pop();

        state.parameters = {
          ...state.parameters,
          ...lastState.parameters,
        };

        return state;
      }

      default:
        return state;
    }
  }
);

export const SlopesProvider = ({
  children,
  orderParams,
}: {
  children: React$Node,
  orderParams: ?Parameters,
}) => {
  const initialState = {
    history: [],
    animateTransitions: true,
    isPoweredOn: true,
    parameters:
      orderParams || retrieveLastSessionSlopesParams() || defaultParameters,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  // ACTIONS
  const toggleParameter = useRef(parameterName => {
    trackParameterChange(parameterName);

    dispatch({
      type: 'TOGGLE_PARAMETER',
      parameterName,
    });
  });

  const tweakParameter = useRef((key, value) => {
    trackParameterChange(key);

    dispatch({
      type: 'TWEAK_PARAMETER',
      payload: { [key]: value },
    });
  });

  const shuffle = useRef(() => {
    analytics.logEvent('shuffle', { machineName: 'slopes' });

    dispatch({
      type: 'SHUFFLE',
    });
  });

  const toggleMachinePower = useRef(() => {
    analytics.logEvent('toggle-machine-power', { machineName: 'slopes' });

    dispatch({
      type: 'TOGGLE_MACHINE_POWER',
    });
  });

  const undo = useRef(() =>
    dispatch({
      type: 'UNDO',
    })
  );

  useUndo(undo.current);

  const disabledParams = useRef({});
  updateDisabledParams(disabledParams, state.parameters);

  const updateLocalStorage = useRef(
    debounce(params => {
      setSlopesParams(params);
    }, 1000)
  );

  React.useEffect(() => {
    updateLocalStorage.current(state.parameters);
  });

  return (
    <SlopesContext.Provider
      value={{
        seed: state.parameters.seed,
        enableDarkMode: state.parameters.enableDarkMode,
        enableMargins: state.parameters.enableMargins,
        amplitudeAmount: state.parameters.amplitudeAmount,
        octaveAmount: state.parameters.octaveAmount,
        perspective: state.parameters.perspective,
        lineAmount: state.parameters.lineAmount,
        spikyness: state.parameters.spikyness,
        staticAmount: state.parameters.staticAmount,
        polarAmount: state.parameters.polarAmount,
        omega: state.parameters.omega,
        splitUniverse: state.parameters.splitUniverse,
        enableOcclusion: state.parameters.enableOcclusion,
        peaksCurve: state.parameters.peaksCurve,
        personInflateAmount: state.parameters.personInflateAmount,
        wavelength: state.parameters.wavelength,
        waterBoilAmount: state.parameters.waterBoilAmount,
        ballSize: state.parameters.ballSize,
        dotAmount: state.parameters.dotAmount,
        enableMirrored: state.parameters.enableMirrored,

        toggleParameter: toggleParameter.current,
        tweakParameter: tweakParameter.current,
        shuffle: shuffle.current,
        toggleMachinePower: toggleMachinePower.current,

        animateTransitions: state.animateTransitions,
        isPoweredOn: state.isPoweredOn,

        disabledParams: disabledParams.current,
      }}
    >
      {children}
    </SlopesContext.Provider>
  );
};
